// src/scripts/seedRevealMatch.ts
//
// Utility to inspect, seed, and cycle test data for progressive avatar reveal.
// Target users: phoenix5546123@gmail.com & admin@ally-jis.com
// Match ID: 4dcf7772-f682-4340-b5df-a900a3b19f6a

import dotenv from 'dotenv';
dotenv.config();

import { supabaseAdmin } from '../config/supabase';
import { getReveal } from '../app/services/matchReveal.service';

const MATCH_ID = '4dcf7772-f682-4340-b5df-a900a3b19f6a';
const EMAIL_PHOENIX = 'phoenix5546123@gmail.com';
const EMAIL_ADMIN = 'admin@ally-jis.com';

const SAMPLE_PHOENIX_AVATAR =
  'https://pub-21734b6a6db44e4bbb01a1a37662f875.r2.dev/avatars/00ac5f7b-9443-447b-b9f3-549aac1abc82/1789996931446-Group_9.png';

async function main() {
  const targetPointsArg = process.argv[2];
  const targetPoints = targetPointsArg !== undefined ? parseInt(targetPointsArg, 10) : 175; // default to Stage 3 / Tier 3

  console.log(`\n======================================================`);
  console.log(`🎯 Seeding Reveal Test for Match: ${MATCH_ID}`);
  console.log(`Target points: ${targetPoints} pts (Profile unlock target: 250 pts)`);
  console.log(`======================================================\n`);

  // 1. Fetch users
  const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
  const phoenixUser = userList?.users.find((u) => u.email?.toLowerCase() === EMAIL_PHOENIX.toLowerCase());
  const adminUser = userList?.users.find((u) => u.email?.toLowerCase() === EMAIL_ADMIN.toLowerCase());

  if (!phoenixUser || !adminUser) {
    console.error('❌ Could not find users. Phoenix:', Boolean(phoenixUser), 'Admin:', Boolean(adminUser));
    process.exit(1);
  }

  console.log(`✓ User Phoenix: ${phoenixUser.id} (${EMAIL_PHOENIX})`);
  console.log(`✓ User Admin:   ${adminUser.id} (${EMAIL_ADMIN})`);

  // 2. Ensure Phoenix has a valid photo URL in profiles table
  const { data: phoenixProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, avatar_url')
    .eq('id', phoenixUser.id)
    .single();

  if (!phoenixProfile?.avatar_url || !phoenixProfile.avatar_url.startsWith('http')) {
    console.log(`\nUpdating Phoenix profile with high-res test photo...`);
    await supabaseAdmin
      .from('profiles')
      .update({ avatar_url: SAMPLE_PHOENIX_AVATAR })
      .eq('id', phoenixUser.id);
    console.log(`✓ Phoenix avatar_url set to: ${SAMPLE_PHOENIX_AVATAR}`);
  } else {
    console.log(`✓ Phoenix avatar_url is already valid: ${phoenixProfile.avatar_url}`);
  }

  // 3. Ensure Admin has a valid photo URL
  const { data: adminProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, avatar_url')
    .eq('id', adminUser.id)
    .single();

  console.log(`✓ Admin avatar_url: ${adminProfile?.avatar_url}`);

  // 4. Determine stage based on points/streak
  let stage = 1;
  let dayStreak = 2;
  if (targetPoints >= 200) {
    stage = 4;
    dayStreak = 10;
  } else if (targetPoints >= 150) {
    stage = 3;
    dayStreak = 7;
  } else if (targetPoints >= 100) {
    stage = 2;
    dayStreak = 4;
  } else if (targetPoints >= 50) {
    stage = 2;
    dayStreak = 3;
  }

  const isRevealed = targetPoints >= 250;

  // 5. Update match row
  const { error: matchUpdateErr } = await supabaseAdmin
    .from('matches')
    .update({
      match_points: targetPoints,
      stage_points: targetPoints,
      current_stage: stage,
      day_streak: dayStreak,
      status: 'confirmed',
      revealed_at: isRevealed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', MATCH_ID);

  if (matchUpdateErr) {
    console.error('❌ Failed to update match:', matchUpdateErr);
    process.exit(1);
  }

  console.log(`\n✓ Match updated:`);
  console.log(`  - match_points: ${targetPoints} / 250`);
  console.log(`  - current_stage: Stage ${stage}`);
  console.log(`  - day_streak: ${dayStreak} days`);
  console.log(`  - isRevealed: ${isRevealed}`);

  // 6. Test getReveal() from Phoenix perspective
  const revealPhoenix = await getReveal(MATCH_ID, phoenixUser.id);
  console.log(`\n------------------------------------------------------`);
  console.log(`🔍 [PHOENIX VIEWING ADMIN] Reveal Data Result:`);
  console.log(`  - Tier: ${revealPhoenix.avatarReveal.tier} (0=Hidden ... 5=Full)`);
  console.log(`  - Progress: ${(revealPhoenix.avatarReveal.progress * 100).toFixed(1)}%`);
  console.log(`  - Dominant Color: ${revealPhoenix.avatarReveal.dominantColor}`);
  console.log(`  - Has Photo: ${revealPhoenix.avatarReveal.hasPhoto}`);
  console.log(`  - Preview URL (Data URI): ${revealPhoenix.avatarReveal.previewUrl ? revealPhoenix.avatarReveal.previewUrl.slice(0, 48) + '...' : 'null'}`);
  console.log(`  - Real Partner Full Name: ${revealPhoenix.partner.fullName ?? 'Locked'}`);
  console.log(`  - Real Partner Avatar URL: ${revealPhoenix.partner.avatarUrl ?? 'Locked'}`);

  // 7. Test getReveal() from Admin perspective
  const revealAdmin = await getReveal(MATCH_ID, adminUser.id);
  console.log(`\n🔍 [ADMIN VIEWING PHOENIX] Reveal Data Result:`);
  console.log(`  - Tier: ${revealAdmin.avatarReveal.tier} (0=Hidden ... 5=Full)`);
  console.log(`  - Progress: ${(revealAdmin.avatarReveal.progress * 100).toFixed(1)}%`);
  console.log(`  - Dominant Color: ${revealAdmin.avatarReveal.dominantColor}`);
  console.log(`  - Has Photo: ${revealAdmin.avatarReveal.hasPhoto}`);
  console.log(`  - Preview URL (Data URI): ${revealAdmin.avatarReveal.previewUrl ? revealAdmin.avatarReveal.previewUrl.slice(0, 48) + '...' : 'null'}`);
  console.log(`  - Real Partner Full Name: ${revealAdmin.partner.fullName ?? 'Locked'}`);
  console.log(`  - Real Partner Avatar URL: ${revealAdmin.partner.avatarUrl ?? 'Locked'}`);

  console.log(`\n======================================================`);
  console.log(`✨ Done! You can run this anytime with custom points:`);
  console.log(`   npx ts-node src/scripts/seedRevealMatch.ts <points>`);
  console.log(`   Examples:`);
  console.log(`     npx ts-node src/scripts/seedRevealMatch.ts 25   (Tier 0 - Aura only)`);
  console.log(`     npx ts-node src/scripts/seedRevealMatch.ts 75   (Tier 1 - Color fog)`);
  console.log(`     npx ts-node src/scripts/seedRevealMatch.ts 125  (Tier 2 - Silhouette)`);
  console.log(`     npx ts-node src/scripts/seedRevealMatch.ts 175  (Tier 3 - Blurry face)`);
  console.log(`     npx ts-node src/scripts/seedRevealMatch.ts 225  (Tier 4 - Almost clear)`);
  console.log(`     npx ts-node src/scripts/seedRevealMatch.ts 250  (Tier 5 - 100% Ceremony)`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
