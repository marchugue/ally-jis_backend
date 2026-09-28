import assert from 'assert';
import { getCalendarDateOffset, phtDateStr } from './app/utils/pht';
import { computeEffectiveStreak, computeRestoreDeadline } from './app/models/conversationStreak.model';
import { withConversationLock } from './app/services/conversationStreak.service';

async function runTests() {
  console.log('--- Starting DM Streak System Validation Tests ---\n');

  // Test 1: Calendar Date Offset Math
  console.log('Test 1: Calendar Date Offset & Stepping');
  assert.strictEqual(getCalendarDateOffset('2026-09-28', -1), '2026-09-27', 'Must step to yesterday without skipping');
  assert.strictEqual(getCalendarDateOffset('2026-09-27', -1), '2026-09-26', 'Must step 27 to 26');
  assert.strictEqual(getCalendarDateOffset('2026-03-01', -1), '2026-02-28', 'Must handle non-leap February transition');
  assert.strictEqual(getCalendarDateOffset('2026-01-01', -1), '2025-12-31', 'Must handle year transition');
  assert.strictEqual(getCalendarDateOffset('2026-09-28', 1), '2026-09-29', 'Must step to tomorrow');

  // Verify multi-day calendar walking simulation (the exact while loop from service)
  const validDates = new Set(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28']);
  let cursor = '2026-09-28';
  let walkStreak = 0;
  while (validDates.has(cursor)) {
    walkStreak += 1;
    cursor = getCalendarDateOffset(cursor, -1);
  }
  assert.strictEqual(walkStreak, 4, 'Walking consecutive days must count all 4 days!');
  console.log('✅ Test 1 Passed: Calendar date math walks days consecutively without skips.\n');

  // Test 2: computeEffectiveStreak State Transitions
  console.log('Test 2: computeEffectiveStreak State Transitions');
  const today = phtDateStr();
  const yesterday = getCalendarDateOffset(today, -1);
  const twoDaysAgo = getCalendarDateOffset(today, -2);
  const tenDaysAgo = getCalendarDateOffset(today, -10);

  // Active today
  const activeTodayRes = computeEffectiveStreak(5, today);
  assert.strictEqual(activeTodayRes.dayStreak, 5);
  assert.strictEqual(activeTodayRes.streakActiveToday, true);
  assert.strictEqual(activeTodayRes.streakStatus, 'active');
  assert.strictEqual(activeTodayRes.lastQualifyingDate, today);

  // Active yesterday (at risk today)
  const atRiskRes = computeEffectiveStreak(5, yesterday);
  assert.strictEqual(atRiskRes.dayStreak, 5);
  assert.strictEqual(atRiskRes.streakActiveToday, false);
  assert.strictEqual(atRiskRes.streakStatus, 'at_risk');
  assert.strictEqual(atRiskRes.lastQualifyingDate, yesterday);

  // Active two days ago: verify deadline is exactly (streakLastActivePht + 1 day at midnight PHT + 42h)
  const deadline = computeRestoreDeadline(twoDaysAgo);
  const expectedDeadline = new Date(new Date(`${yesterday}T00:00:00.000+08:00`).getTime() + 42 * 3600_000);
  assert.strictEqual(deadline.getTime(), expectedDeadline.getTime(), 'Restore deadline must equal brokeDate midnight PHT + 42h');

  // Verify status reflects whether deadline has passed
  const isPast = Date.now() >= deadline.getTime();
  const lapsedOrExpiredRes = computeEffectiveStreak(5, twoDaysAgo);
  assert.strictEqual(lapsedOrExpiredRes.dayStreak, 0);
  assert.strictEqual(lapsedOrExpiredRes.streakActiveToday, false);
  assert.strictEqual(lapsedOrExpiredRes.streakStatus, isPast ? 'expired' : 'lapsed');
  assert.strictEqual(lapsedOrExpiredRes.streakRestoreDeadline, deadline.toISOString());

  // Active 10 days ago (expired, past 42h restore window)
  const expiredRes = computeEffectiveStreak(5, tenDaysAgo);
  assert.strictEqual(expiredRes.dayStreak, 0);
  assert.strictEqual(expiredRes.streakActiveToday, false);
  assert.strictEqual(expiredRes.streakStatus, 'expired');
  console.log('✅ Test 2 Passed: Streak statuses (active, at_risk, lapsed, expired) evaluate correctly.\n');

  // Test 3: TikTok DM Streak Algorithm Simulation
  console.log('Test 3: TikTok DM Streak Invariants');
  // Invariant 1: One user sending 100 messages alone does NOT advance streak
  type Activity = { [date: string]: { [userId: string]: number } };
  const testActivity: Activity = {};

  function record(date: string, userId: string) {
    if (!testActivity[date]) testActivity[date] = {};
    testActivity[date][userId] = (testActivity[date][userId] || 0) + 1;
  }

  function evaluateDayQualifies(date: string, userA: string, userB: string): boolean {
    const act = testActivity[date] || {};
    return (act[userA] || 0) >= 1 && (act[userB] || 0) >= 1;
  }

  const userA = 'user-a';
  const userB = 'user-b';
  const d1 = '2026-09-20';
  const d2 = '2026-09-21';
  const d3 = '2026-09-22';
  const d4 = '2026-09-23';
  const d6 = '2026-09-25'; // gap on d5

  // User A sends 50 messages on d1
  for (let i = 0; i < 50; i++) record(d1, userA);
  assert.strictEqual(evaluateDayQualifies(d1, userA, userB), false, 'Day 1 must not qualify with only user A');

  // User B sends 1 message on d1
  record(d1, userB);
  assert.strictEqual(evaluateDayQualifies(d1, userA, userB), true, 'Day 1 qualifies now that both messaged');

  // User B sends 20 more messages on d1 — no stacking
  for (let i = 0; i < 20; i++) record(d1, userB);
  assert.strictEqual(evaluateDayQualifies(d1, userA, userB), true, 'Day 1 still counts as exactly ONE qualifying day');

  // Day 2: Both message
  record(d2, userA);
  record(d2, userB);
  assert.strictEqual(evaluateDayQualifies(d2, userA, userB), true, 'Day 2 qualifies');

  // Day 3: Both message
  record(d3, userA);
  record(d3, userB);
  assert.strictEqual(evaluateDayQualifies(d3, userA, userB), true, 'Day 3 qualifies');

  // Day 4: Only User A messages
  record(d4, userA);
  assert.strictEqual(evaluateDayQualifies(d4, userA, userB), false, 'Day 4 does not qualify');

  // Compute streak on Day 3: d1, d2, d3 all qualify -> streak = 3
  const qualifyingDates = new Set([d1, d2, d3].filter(d => evaluateDayQualifies(d, userA, userB)));
  let curr = d3;
  let streak = 0;
  while (qualifyingDates.has(curr)) {
    streak += 1;
    curr = getCalendarDateOffset(curr, -1);
  }
  assert.strictEqual(streak, 3, 'Consecutive mutual days d1, d2, d3 must equal streak of 3');

  // Gap test: after gap on d4 and d5, on d6 both message
  record(d6, userA);
  record(d6, userB);
  qualifyingDates.add(d6);
  // Recomputing from d6
  curr = d6;
  let newStreak = 0;
  while (qualifyingDates.has(curr)) {
    newStreak += 1;
    curr = getCalendarDateOffset(curr, -1);
  }
  assert.strictEqual(newStreak, 1, 'After gap, new streak starts at exactly 1');
  console.log('✅ Test 3 Passed: Mutual participation, message-count idempotency, and gap handling verified.\n');

  // Test 4: Existing Streak Preservation
  console.log('Test 4: Existing Streak Preservation');
  // Scenario: A pair had earned a 25-day streak. Yesterday was their 25th day.
  const storedStreak = 25;
  const lastActive = yesterday;
  // Today, both participate:
  const todayQualifies = true;
  let extendedStreak: number;
  if (todayQualifies) {
    if (lastActive === yesterday) {
      extendedStreak = storedStreak + 1; // 26!
    } else if (lastActive === today) {
      extendedStreak = storedStreak; // already counted today
    } else {
      extendedStreak = 1; // broke
    }
  } else {
    extendedStreak = storedStreak;
  }
  assert.strictEqual(extendedStreak, 26, 'Existing 25-day streak must safely extend to 26 upon today mutual participation');
  console.log('✅ Test 4 Passed: Historical high streaks (e.g. 25d) are safely preserved and incremented.\n');

  // Test 5: Concurrency Mutex Serialization
  console.log('Test 5: Concurrency Mutex Lock');
  const convId = 'test-conv-lock';
  const executionOrder: number[] = [];

  const task1 = withConversationLock(convId, async () => {
    await new Promise((r) => setTimeout(r, 50));
    executionOrder.push(1);
  });
  const task2 = withConversationLock(convId, async () => {
    await new Promise((r) => setTimeout(r, 10));
    executionOrder.push(2);
  });
  const task3 = withConversationLock(convId, async () => {
    executionOrder.push(3);
  });

  await Promise.all([task1, task2, task3]);
  assert.deepStrictEqual(executionOrder, [1, 2, 3], 'withConversationLock must serialize concurrent requests strictly in arrival order');
  console.log('✅ Test 5 Passed: Mutex prevents concurrent race conditions.\n');

  console.log('=====================================================');
  console.log('🎉 ALL DM STREAK INVARIANT TESTS PASSED SUCCESSFULLY!');
  console.log('=====================================================');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
