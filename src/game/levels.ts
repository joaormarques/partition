import type { BallKind } from './Ball';

/** The level each kind first appears on. */
export const UNLOCKS: ReadonlyArray<readonly [BallKind, number]> = [
  ['basic', 1],
  ['heavy', 2],
  ['glass', 3],
  ['splitter', 4],
  ['phantom', 5],
];

export const MAX_BALLS = 16;

export function unlockedKinds(level: number): BallKind[] {
  return UNLOCKS.filter(([, at]) => level >= at).map(([kind]) => kind);
}

/** The kind introduced on exactly this level, if any. */
export function newKindAt(level: number): BallKind | null {
  return UNLOCKS.find(([, at]) => at === level)?.[0] ?? null;
}

/** Pick a random unlocked kind; basic balls are twice as likely. */
export function randomKind(level: number, rng: () => number): BallKind {
  const pool = unlockedKinds(level).flatMap((k) => (k === 'basic' ? [k, k] : [k]));
  return pool[Math.floor(rng() * pool.length)];
}
