import { BALL_SPEED, CELL, HEIGHT, WIDTH } from './constants';
import type { Grid } from './Grid';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BallKind = 'basic' | 'heavy' | 'glass' | 'phantom' | 'splitter' | 'shard';

export interface KindSpec {
  label: string;
  blurb: string;
  radius: number;
  speed: number;
  /** Downward acceleration in px/s². */
  gravity: number;
  /** Passes through filled cells; only the field edge stops it. */
  ghost: boolean;
  /** Counts as occupying its region, so the region is not filled. */
  seeds: boolean;
  /** Bounces off other balls. */
  collides: boolean;
  /** Speed is renormalised after ball-ball collisions. */
  constantSpeed: boolean;
  /** Wall bounces before it breaks (glass); Infinity for everything else. */
  hp: number;
  /** Seconds before it disappears (shards); Infinity for everything else. */
  life: number;
}

export const KINDS: Record<BallKind, KindSpec> = {
  basic: {
    label: 'Basic',
    blurb: 'Bounces at a constant speed.',
    radius: 6, speed: BALL_SPEED, gravity: 0,
    ghost: false, seeds: true, collides: true, constantSpeed: true, hp: Infinity, life: Infinity,
  },
  heavy: {
    label: 'Heavy',
    blurb: 'Pulled down by gravity.',
    radius: 8, speed: 140, gravity: 260,
    ghost: false, seeds: true, collides: true, constantSpeed: false, hp: Infinity, life: Infinity,
  },
  glass: {
    label: 'Glass',
    blurb: 'Shatters after a few bounces. Mind the shards.',
    radius: 7, speed: BALL_SPEED, gravity: 0,
    ghost: false, seeds: true, collides: true, constantSpeed: true, hp: 6, life: Infinity,
  },
  splitter: {
    label: 'Splitter',
    blurb: 'Splits in two when it breaks a wall.',
    radius: 8, speed: BALL_SPEED * 0.9, gravity: 0,
    ghost: false, seeds: true, collides: true, constantSpeed: true, hp: Infinity, life: Infinity,
  },
  phantom: {
    label: 'Phantom',
    blurb: 'Drifts through filled areas and can hit walls from behind.',
    radius: 7, speed: BALL_SPEED * 0.55, gravity: 0,
    ghost: true, seeds: false, collides: false, constantSpeed: true, hp: Infinity, life: Infinity,
  },
  shard: {
    label: 'Shard',
    blurb: '',
    radius: 3, speed: 260, gravity: 0,
    ghost: false, seeds: false, collides: false, constantSpeed: true, hp: Infinity, life: 1.2,
  },
};

const HEAVY_MAX_SPEED = 420;
const HEAVY_MIN_BOUNCE = 200;
const HEAVY_MIN_VX = 40;

export class Ball {
  r: number;
  speed: number;
  hp: number;
  life: number;
  dead = false;

  constructor(
    public x: number,
    public y: number,
    public vx: number,
    public vy: number,
    public readonly kind: BallKind = 'basic',
  ) {
    const spec = KINDS[kind];
    this.r = spec.radius;
    this.speed = spec.speed;
    this.hp = spec.hp;
    this.life = spec.life;
  }

  get spec(): KindSpec {
    return KINDS[this.kind];
  }

  cell(): [number, number] {
    return [Math.floor(this.x / CELL), Math.floor(this.y / CELL)];
  }
}

export function circleRectOverlap(cx: number, cy: number, r: number, rect: Rect): boolean {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/** Does a circle at (x, y) overlap any solid cell (or the outside of the field)? */
export function overlapsSolid(grid: Grid, x: number, y: number, r: number): boolean {
  const x0 = Math.floor((x - r) / CELL);
  const x1 = Math.floor((x + r) / CELL);
  const y0 = Math.floor((y - r) / CELL);
  const y1 = Math.floor((y + r) / CELL);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (grid.isSolid(cx, cy) && circleRectOverlap(x, y, r, { x: cx * CELL, y: cy * CELL, w: CELL, h: CELL })) {
        return true;
      }
    }
  }
  return false;
}

function outsideField(x: number, y: number, r: number): boolean {
  return x - r < 0 || y - r < 0 || x + r > WIDTH || y + r > HEIGHT;
}

/**
 * Move a ball against the grid, one axis at a time, in sub-steps of at most a
 * quarter cell so fast balls can't tunnel through single-cell walls.
 * Returns how many times it bounced off a wall or the field edge.
 */
export function moveBall(ball: Ball, grid: Grid, dt: number): number {
  const { gravity, ghost } = ball.spec;
  const blocked = ghost
    ? (x: number, y: number) => outsideField(x, y, ball.r)
    : (x: number, y: number) => overlapsSolid(grid, x, y, ball.r);

  const maxSpeed = Math.max(Math.hypot(ball.vx, ball.vy), gravity > 0 ? HEAVY_MAX_SPEED : 0);
  const steps = Math.max(1, Math.ceil((maxSpeed * dt) / (CELL / 4)));
  const sdt = dt / steps;
  let bounces = 0;

  for (let s = 0; s < steps; s++) {
    if (gravity > 0) ball.vy += gravity * sdt;

    const nx = ball.x + ball.vx * sdt;
    if (blocked(nx, ball.y)) {
      ball.vx = -ball.vx;
      bounces++;
    } else ball.x = nx;

    const ny = ball.y + ball.vy * sdt;
    if (blocked(ball.x, ny)) {
      // Heavy balls get a minimum kick off the floor so they never settle.
      ball.vy = gravity > 0 && ball.vy > 0 ? -Math.max(ball.vy, HEAVY_MIN_BOUNCE) : -ball.vy;
      bounces++;
    } else ball.y = ny;
  }

  if (gravity > 0) {
    const s = Math.hypot(ball.vx, ball.vy);
    if (s > HEAVY_MAX_SPEED) {
      ball.vx = (ball.vx / s) * HEAVY_MAX_SPEED;
      ball.vy = (ball.vy / s) * HEAVY_MAX_SPEED;
    }
    if (Math.abs(ball.vx) < HEAVY_MIN_VX) ball.vx = (ball.vx < 0 ? -1 : 1) * HEAVY_MIN_VX;
  }
  return bounces;
}

/** Elastic equal-mass collisions between balls that collide. */
export function collideBalls(balls: Ball[], grid: Grid): void {
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (!a.spec.collides) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      if (!b.spec.collides) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (d >= min || d === 0) continue;

      const nx = dx / d;
      const ny = dy / d;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        a.vx += rv * nx;
        a.vy += rv * ny;
        b.vx -= rv * nx;
        b.vy -= rv * ny;
        normalise(a);
        normalise(b);
      }

      // Push apart, but never into a wall.
      const push = (min - d) / 2;
      const ax = a.x - nx * push;
      const ay = a.y - ny * push;
      if (!overlapsSolid(grid, ax, ay, a.r)) {
        a.x = ax;
        a.y = ay;
      }
      const bx = b.x + nx * push;
      const by = b.y + ny * push;
      if (!overlapsSolid(grid, bx, by, b.r)) {
        b.x = bx;
        b.y = by;
      }
    }
  }
}

function normalise(ball: Ball): void {
  if (!ball.spec.constantSpeed) return;
  const s = Math.hypot(ball.vx, ball.vy);
  if (s === 0) return;
  ball.vx = (ball.vx / s) * ball.speed;
  ball.vy = (ball.vy / s) * ball.speed;
}
