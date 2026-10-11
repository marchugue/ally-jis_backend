// src/app/services/avatarReveal.service.ts
//
// Progressive real-avatar reveal.
//
// Generates tiny, irreversibly down-scaled thumbnails of a user's real
// avatar — one per reveal tier — and returns ONLY the thumbnail for the
// tier the match has earned. The full-resolution photo is never sent to the
// partner until the profile is unlocked (250 pts / revealed_at).
//
// Thumbnails are returned inline as data URIs (each < ~2 KB), so there is no
// storage bucket, no guessable URL and no extra auth surface. Results are
// cached in-memory per avatar URL.

import sharp from 'sharp';
import {
  REVEAL_TIERS,
  TOTAL_POINTS_FOR_PROFILE_UNLOCK,
  revealTierFor,
} from '../constants/progression';
import type { AvatarRevealView } from '../types/matchReveal.types';

interface AvatarVariants {
  dominantColor: string | null;
  /** tier -> data URI */
  thumbs: Record<number, string>;
}

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 6000;
const CACHE_LIMIT = 500;

const cache = new Map<string, AvatarVariants>();
const inflight = new Map<string, Promise<AvatarVariants | null>>();

function remember(key: string, value: AvatarVariants) {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

async function fetchSource(url: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_SOURCE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_SOURCE_BYTES) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function buildVariants(url: string): Promise<AvatarVariants | null> {
  const source = await fetchSource(url);
  if (!source) return null;

  try {
    // Normalise once: EXIF-rotate, square-crop around the most "interesting" region.
    const base = await sharp(source, { failOn: 'none', animated: false })
      .rotate()
      .resize(256, 256, { fit: 'cover', position: sharp.strategy.attention })
      .removeAlpha()
      .toBuffer();

    const stats = await sharp(base).stats();
    const { r, g, b } = stats.dominant;
    const dominantColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;

    const thumbs: Record<number, string> = {};
    for (const t of REVEAL_TIERS) {
      if (!t.thumbWidth) continue;
      const out = await sharp(base)
        .resize(t.thumbWidth, t.thumbWidth, { kernel: sharp.kernel.cubic })
        .webp({ quality: 60 })
        .toBuffer();
      thumbs[t.tier] = `data:image/webp;base64,${out.toString('base64')}`;
    }

    return { dominantColor, thumbs };
  } catch (err) {
    console.error('[avatarReveal] Failed to build variants:', err);
    return null;
  }
}

async function getVariants(url: string): Promise<AvatarVariants | null> {
  const hit = cache.get(url);
  if (hit) return hit;

  const pending = inflight.get(url);
  if (pending) return pending;

  const job = buildVariants(url)
    .then((v) => {
      if (v) remember(url, v);
      return v;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, job);
  return job;
}

/**
 * Builds the reveal view for the partner's avatar given the match's points.
 * Never includes more image detail than the earned tier allows.
 */
export async function buildAvatarReveal(input: {
  avatarUrl: string | null | undefined;
  matchPoints: number;
  isProfileUnlocked: boolean;
}): Promise<AvatarRevealView> {
  const target = TOTAL_POINTS_FOR_PROFILE_UNLOCK;
  const tier = revealTierFor(input.matchPoints, input.isProfileUnlocked);
  const next = REVEAL_TIERS.find((t) => t.tier === tier.tier + 1) ?? null;

  const tierStart = Math.round(tier.startFraction * target);
  const tierEnd = next ? Math.round(next.startFraction * target) : target;
  const progress = input.isProfileUnlocked ? 1 : Math.max(0, Math.min(1, input.matchPoints / target));

  const view: AvatarRevealView = {
    tier: tier.tier,
    maxTier: REVEAL_TIERS.length - 1,
    progress,
    matchPoints: input.matchPoints,
    target,
    tierStart,
    tierEnd,
    tierThresholds: REVEAL_TIERS.map((t) => Math.round(t.startFraction * target)),
    hasPhoto: Boolean(input.avatarUrl),
    dominantColor: null,
    previewUrl: null,
  };

  if (!input.avatarUrl) return view;

  if (input.isProfileUnlocked) {
    view.previewUrl = input.avatarUrl;
    const variants = await getVariants(input.avatarUrl).catch(() => null);
    view.dominantColor = variants?.dominantColor ?? null;
    return view;
  }

  const variants = await getVariants(input.avatarUrl).catch(() => null);
  if (!variants) return view;

  view.dominantColor = variants.dominantColor;
  view.previewUrl = variants.thumbs[tier.tier] ?? null;
  return view;
}

/** Drop cached variants (e.g. after a user changes their avatar). */
export function invalidateAvatarReveal(avatarUrl: string | null | undefined): void {
  if (avatarUrl) cache.delete(avatarUrl);
}
