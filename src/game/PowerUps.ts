import type { Ball, Rect } from './Ball';
import { CELL } from './constants';

export type PowerKind = 'magnet' | 'bomb' | 'multiplier' | 'fast' | 'freeze';

export interface PowerSpec {
  label: string;
  blurb: string;
  weight: number;
}

export const POWERS: Record<PowerKind, PowerSpec> = {
  magnet: { label: 'Magnet', blurb: 'Your next wall pushes balls away.', weight: 3 },
  bomb: { label: 'Bomb', blurb: 'Your next click detonates, destroying nearby balls.', weight: 2 },
  multiplier: { label: 'Multiplier', blurb: 'Extra points for a while.', weight: 3 },
  fast: { label: 'Fast walls', blurb: 'Walls grow twice as fast for a while.', weight: 3 },
  freeze: { label: 'Freeze', blurb: 'Balls stop moving briefly.', weight: 2 },
};

/** A pickup sitting on one empty cell. Collected when that cell gets filled. */
export interface PowerUp {
  kind: PowerKind;
  cx: number;
  cy: number;
  at: number;
}

export const POWERUP_LIFETIME = 12; // s on the field before it vanishes
export const POWERUP_FIRST_SPAWN = 5; // s after level start
export const POWERUP_SPAWN_MIN = 6; // s between spawns
export const POWERUP_SPAWN_MAX = 11;
export const POWERUP_MAX_ON_FIELD = 2;
export const POWERUP_MIN_BALL_DISTANCE = CELL * 3;

export const BOMB_RADIUS = CELL * 4.5;
export const BOMB_POINTS_PER_BALL = 100;
export const MAGNET_RANGE = CELL * 3;
export const MULTIPLIER_TIME = 10;
export const MAX_MULTIPLIER = 3;
export const FAST_TIME = 10;
export const FAST_FACTOR = 2;
export const FREEZE_TIME = 2;
export const MAX_CHARGES = 3; // bombs or magnets held at once

export function randomPower(rng: () => number): PowerKind {
  const entries = Object.entries(POWERS) as Array<[PowerKind, PowerSpec]>;
  const total = entries.reduce((sum, [, s]) => sum + s.weight, 0);
  let roll = rng() * total;
  for (const [kind, spec] of entries) {
    roll -= spec.weight;
    if (roll < 0) return kind;
  }
  return entries[entries.length - 1][0];
}

/**
 * Magnet field: a ball inside `range` of the rect that is heading toward it
 * has that component of its velocity reflected, so it turns away.
 */
export function repel(ball: Ball, rect: Rect, range: number): void {
  const nx = Math.max(rect.x, Math.min(ball.x, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(ball.y, rect.y + rect.h));
  const dx = ball.x - nx;
  const dy = ball.y - ny;
  const d = Math.hypot(dx, dy);
  if (d === 0 || d > range + ball.r) return;
  const ux = dx / d;
  const uy = dy / d;
  const vn = ball.vx * ux + ball.vy * uy;
  if (vn < 0) {
    ball.vx -= 2 * vn * ux;
    ball.vy -= 2 * vn * uy;
  }
}
