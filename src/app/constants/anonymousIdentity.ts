// src/app/constants/anonymousIdentity.ts
//
// Pool of alias/avatar pairs handed out to the two sides of a match. Each
// entry's `avatar` key is a string only — the frontend owns the actual
// icon/illustration for that key (see web: lib/matchOptions.ts). Keeping
// the pool here (rather than a lookup table) means adding a new alias is
// a one-line change with no migration.

export interface AnonymousIdentity {
  alias: string;
  avatar: string;
}

export const ANONYMOUS_IDENTITY_POOL: AnonymousIdentity[] = [
  { alias: 'Anonymous Fox', avatar: 'fox' },
  { alias: 'Anonymous Wolf', avatar: 'wolf' },
  { alias: 'Anonymous Whale', avatar: 'whale' },
  { alias: 'Anonymous Owl', avatar: 'owl' },
  { alias: 'Anonymous Panda', avatar: 'panda' },
  { alias: 'Anonymous Otter', avatar: 'otter' },
  { alias: 'Anonymous Falcon', avatar: 'falcon' },
  { alias: 'Anonymous Koala', avatar: 'koala' },
  { alias: 'Anonymous Lynx', avatar: 'lynx' },
  { alias: 'Anonymous Dolphin', avatar: 'dolphin' },
  { alias: 'Anonymous Raven', avatar: 'raven' },
  { alias: 'Anonymous Badger', avatar: 'badger' },
];

/** Picks two distinct entries from the pool for the two sides of a match. */
export function pickTwoDistinctIdentities(): [AnonymousIdentity, AnonymousIdentity] {
  const a = Math.floor(Math.random() * ANONYMOUS_IDENTITY_POOL.length);
  let b = Math.floor(Math.random() * (ANONYMOUS_IDENTITY_POOL.length - 1));
  if (b >= a) b += 1; // skip over `a` so b is always different

  return [ANONYMOUS_IDENTITY_POOL[a], ANONYMOUS_IDENTITY_POOL[b]];
}
