import { Ball, type BallKind, type Rect, circleRectOverlap, collideBalls, KINDS, moveBall, overlapsSolid } from './Ball';
import { BALL_SPEED, CELL, COLS, HEIGHT, POINTS_PER_CELL, ROWS, WALL_SPEED, WIDTH } from './constants';
import { DIFFICULTIES, type Difficulty, type DifficultySpec } from './difficulty';
import { FILLED, Grid } from './Grid';
import { MAX_BALLS, newKindAt, randomKind, unlockedKinds } from './levels';
import {
  BOMB_POINTS_PER_BALL,
  BOMB_RADIUS,
  FAST_FACTOR,
  FAST_TIME,
  FREEZE_TIME,
  MAGNET_RANGE,
  MAX_CHARGES,
  MAX_MULTIPLIER,
  MULTIPLIER_TIME,
  POWERS,
  type PowerKind,
  type PowerUp,
  POWERUP_FIRST_SPAWN,
  POWERUP_LIFETIME,
  POWERUP_MAX_ON_FIELD,
  POWERUP_MIN_BALL_DISTANCE,
  POWERUP_SPAWN_MAX,
  POWERUP_SPAWN_MIN,
  randomPower,
  repel,
} from './PowerUps';
import { type Orientation, WallHalf } from './Wall';

export type Phase = 'title' | 'playing' | 'paused' | 'levelComplete' | 'gameOver';

export interface LevelResult {
  livesBonus: number;
  fillBonus: number;
}

/** What survives from one level to the next. */
export interface BallBlueprint {
  kind: BallKind;
  r?: number;
  speed?: number;
  hp?: number;
}

/** A visual ring for a shatter or bomb blast. */
export interface Burst {
  x: number;
  y: number;
  radius: number;
  kind: 'shatter' | 'bomb';
  at: number;
}

/** One-shot notifications for the renderer (particles, shake). */
export type GameEvent =
  | { type: 'wallDone'; rect: Rect; cells: number }
  | { type: 'wallBreak'; rect: Rect; x: number; y: number }
  | { type: 'shatter'; x: number; y: number }
  | { type: 'bomb'; x: number; y: number; radius: number }
  | { type: 'collect'; x: number; y: number; kind: PowerKind }
  | { type: 'bounce'; x: number; kind: BallKind }
  | { type: 'wallStart'; x: number; y: number }
  | { type: 'split'; x: number; y: number }
  | { type: 'levelClear' }
  | { type: 'gameOver' };

/** Floating text, e.g. points earned. */
export interface Popup {
  x: number;
  y: number;
  text: string;
  at: number;
}

export const SHATTER_POINTS = 250;
const SHARD_COUNT = 5;
const SPLIT_CHILD_RADIUS = 5;
const SPLIT_CHILD_SPEED = BALL_SPEED * 1.2;
const SPLIT_SPREAD = 0.6; // radians either side of the parent's heading
const EFFECT_TTL = 1.2; // s that bursts and popups stay in their lists

export class Game {
  grid = new Grid(COLS, ROWS);
  balls: Ball[] = [];
  halves: WallHalf[] = [];
  orientation: Orientation = 'v';
  phase: Phase = 'title';
  level = 1;
  lives = 2;
  score = 0;
  /** Simulation time in seconds, used for effects and timers. */
  time = 0;
  /** Applies from the next startNewGame(). */
  difficulty: Difficulty = 'normal';
  /** The difficulty the current game was started with. */
  activeDifficulty: Difficulty = 'normal';

  // Power-ups
  powerUps: PowerUp[] = [];
  autoSpawnPowerUps = true;
  nextPowerAt = 0;
  /** Charges held for the next click (bomb) or next wall (magnet). Carry across levels. */
  bombs = 0;
  magnets = 0;
  multiplier = 1;
  multiplierUntil = 0;
  fastUntil = 0;
  freezeUntil = 0;

  // Effects
  /** Most recently filled cells and where the fill started, for the fill wave. */
  flash: { indices: number[]; at: number; x: number; y: number } = { indices: [], at: -Infinity, x: 0, y: 0 };
  /** Drained by the renderer each frame. */
  events: GameEvent[] = [];
  lastBreakAt = -Infinity;
  bursts: Burst[] = [];
  popups: Popup[] = [];
  intro: { title: string; subtitle: string; at: number } | null = null;
  result: LevelResult | null = null;

  constructor(private readonly rng: () => number = Math.random) {}

  /** Start a fresh game. A later starting level gets one of each unlocked kind (for testing). */
  startNewGame(level = 1): void {
    this.activeDifficulty = this.difficulty;
    this.level = level;
    this.score = 0;
    this.bombs = 0;
    this.magnets = 0;
    const blueprints: BallBlueprint[] = unlockedKinds(level).map((kind) => ({ kind }));
    while (blueprints.length < level + 1) blueprints.push({ kind: 'basic' });
    this.startLevel(blueprints.slice(0, MAX_BALLS));
  }

  /** Start the current level with the given balls (random positions and headings). */
  startLevel(blueprints: BallBlueprint[] = []): void {
    this.grid = new Grid(COLS, ROWS);
    this.halves = [];
    this.lives = Math.max(1, this.level + 1 + this.rules.extraLives);
    this.result = null;
    this.flash = { indices: [], at: -Infinity, x: 0, y: 0 };
    this.events = [];
    this.bursts = [];
    this.popups = [];
    this.powerUps = [];
    this.nextPowerAt = this.time + POWERUP_FIRST_SPAWN;
    this.multiplier = 1;
    this.multiplierUntil = 0;
    this.fastUntil = 0;
    this.freezeUntil = 0;
    this.balls = this.spawnBalls(blueprints);
    const kind = newKindAt(this.level);
    this.intro = {
      title: `Level ${this.level}`,
      subtitle: kind && kind !== 'basic' ? `New: ${KINDS[kind].label}. ${KINDS[kind].blurb}` : '',
      at: this.time,
    };
    this.phase = 'playing';
  }

  /** Surviving balls carry over; one new ball joins, then top up to level + 1. */
  nextLevel(): void {
    this.level++;
    const carried: BallBlueprint[] = this.balls
      .filter((b) => b.kind !== 'shard' && !b.dead)
      .map((b) => ({ kind: b.kind, r: b.r, speed: b.speed, hp: b.hp }));
    carried.push({ kind: newKindAt(this.level) ?? randomKind(this.level, this.rng) });
    while (carried.length < this.level + 1) carried.push({ kind: randomKind(this.level, this.rng) });
    this.startLevel(carried.slice(0, MAX_BALLS));
  }

  togglePause(): void {
    if (this.phase === 'playing') this.phase = 'paused';
    else if (this.phase === 'paused') this.phase = 'playing';
  }

  toggleOrientation(): void {
    this.orientation = this.orientation === 'h' ? 'v' : 'h';
  }

  /** Rules of the game in progress. */
  get rules(): DifficultySpec {
    return DIFFICULTIES[this.activeDifficulty];
  }

  get winFill(): number {
    return this.rules.winFill;
  }

  get frozen(): boolean {
    return this.time < this.freezeUntil;
  }

  get fastWalls(): boolean {
    return this.time < this.fastUntil;
  }

  /** The player's click: detonate a held bomb, otherwise start a wall. */
  click(cx: number, cy: number): boolean {
    if (this.phase !== 'playing') return false;
    if (this.bombs > 0) {
      this.detonate(cx, cy);
      return true;
    }
    return this.placeWall(cx, cy);
  }

  /** Start a wall on a cell. Only one wall may be building at a time. */
  placeWall(cx: number, cy: number): boolean {
    if (this.phase !== 'playing' || this.halves.length > 0) return false;
    if (!this.grid.inBounds(cx, cy) || this.grid.isSolid(cx, cy)) return false;
    this.halves = [
      new WallHalf(cx, cy, this.orientation, -1),
      new WallHalf(cx, cy, this.orientation, 1),
    ];
    if (this.magnets > 0) {
      this.magnets--;
      for (const h of this.halves) h.magnetic = true;
    }
    this.emit({ type: 'wallStart', x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });
    return true;
  }

  fillRatio(): number {
    return this.grid.fillRatio();
  }

  update(dt: number): void {
    if (this.phase !== 'playing') return;
    this.time += dt;
    if (this.multiplier > 1 && this.time >= this.multiplierUntil) this.multiplier = 1;

    if (!this.frozen) {
      for (const ball of this.balls) {
        const bounces = moveBall(ball, this.grid, dt);
        if (bounces > 0) this.emit({ type: 'bounce', x: ball.x, kind: ball.kind });
        ball.life -= dt;
        if (ball.life <= 0) ball.dead = true;
        if (bounces > 0 && ball.kind === 'glass') {
          ball.hp -= bounces;
          if (ball.hp <= 0) this.shatter(ball);
        }
      }
      this.removeDead();
      collideBalls(this.balls, this.grid);
    }

    for (const half of this.halves) {
      if (half.state !== 'growing' || !half.magnetic) continue;
      const rect = half.rect();
      for (const ball of this.balls) repel(ball, rect, MAGNET_RANGE);
    }

    for (const half of this.halves) {
      if (half.state !== 'growing') continue;
      const hit = this.ballHitting(half);
      if (hit) this.breakHalf(half, hit);
    }

    const wallSpeed = WALL_SPEED * (this.fastWalls ? FAST_FACTOR : 1);
    for (const half of this.halves) {
      if (half.state !== 'growing') continue;
      if (half.grow(this.grid, wallSpeed, dt)) {
        const hit = this.ballHitting(half);
        if (hit) this.breakHalf(half, hit);
        else this.commit(half);
      }
    }
    this.halves = this.halves.filter((h) => h.state === 'growing');
    this.removeDead();
    this.updatePowerUps();
    this.bursts = this.bursts.filter((b) => this.time - b.at < EFFECT_TTL);
    this.popups = this.popups.filter((p) => this.time - p.at < EFFECT_TTL);

    if (this.lives <= 0) {
      this.halves = [];
      this.phase = 'gameOver';
      this.emit({ type: 'gameOver' });
      return;
    }

    if (this.fillRatio() >= this.winFill) this.completeLevel();
  }

  private emit(event: GameEvent): void {
    if (this.events.length < 256) this.events.push(event);
  }

  /** Award points with the current multiplier and show them at (x, y). */
  private addPoints(base: number, x: number, y: number): void {
    if (base <= 0) return;
    const points = base * this.multiplier;
    this.score += points;
    this.popups.push({ x, y, text: `+${points.toLocaleString('en-US')}`, at: this.time });
  }

  private removeDead(): void {
    if (this.balls.some((b) => b.dead)) this.balls = this.balls.filter((b) => !b.dead);
  }

  private ballHitting(half: WallHalf): Ball | undefined {
    if (half.progress <= 0) return undefined;
    const rect = half.rect();
    return this.balls.find((b) => !b.dead && circleRectOverlap(b.x, b.y, b.r, rect));
  }

  private breakHalf(half: WallHalf, ball: Ball): void {
    half.state = 'broken';
    this.lives--;
    this.lastBreakAt = this.time;
    this.emit({ type: 'wallBreak', rect: half.rect(), x: ball.x, y: ball.y });
    if (ball.kind === 'splitter') this.split(ball);
  }

  private split(parent: Ball): void {
    parent.dead = true;
    this.emit({ type: 'split', x: parent.x, y: parent.y });
    const heading = Math.atan2(parent.vy, parent.vx);
    for (const side of [-1, 1]) {
      const a = heading + side * SPLIT_SPREAD;
      const speed = SPLIT_CHILD_SPEED * this.rules.speedScale;
      const child = new Ball(parent.x, parent.y, Math.cos(a) * speed, Math.sin(a) * speed);
      child.r = SPLIT_CHILD_RADIUS;
      child.speed = speed;
      this.balls.push(child);
    }
  }

  private shatter(glass: Ball): void {
    glass.dead = true;
    this.addPoints(SHATTER_POINTS, glass.x, glass.y);
    this.bursts.push({ x: glass.x, y: glass.y, radius: 32, kind: 'shatter', at: this.time });
    this.emit({ type: 'shatter', x: glass.x, y: glass.y });
    const speed = KINDS.shard.speed;
    const offset = this.rng() * Math.PI * 2;
    for (let i = 0; i < SHARD_COUNT; i++) {
      const a = offset + (i / SHARD_COUNT) * Math.PI * 2;
      this.balls.push(new Ball(glass.x, glass.y, Math.cos(a) * speed, Math.sin(a) * speed, 'shard'));
    }
  }

  private detonate(cx: number, cy: number): void {
    this.bombs--;
    const x = cx * CELL + CELL / 2;
    const y = cy * CELL + CELL / 2;
    let destroyed = 0;
    for (const b of this.balls) {
      if (Math.hypot(b.x - x, b.y - y) < BOMB_RADIUS + b.r) {
        b.dead = true;
        destroyed++;
      }
    }
    this.removeDead();
    this.bursts.push({ x, y, radius: BOMB_RADIUS, kind: 'bomb', at: this.time });
    this.emit({ type: 'bomb', x, y, radius: BOMB_RADIUS });
    this.addPoints(destroyed * BOMB_POINTS_PER_BALL, x, y);
  }

  private commit(half: WallHalf): void {
    const indices: number[] = [];
    for (const [x, y] of half.coveredCells()) {
      if (!this.grid.isSolid(x, y)) {
        this.grid.set(x, y, FILLED);
        indices.push(this.grid.index(x, y));
      }
    }
    // Phantoms and shards don't hold a region open.
    const seeds = this.balls.filter((b) => b.spec.seeds).map((b) => b.cell());
    indices.push(...this.grid.fillUnreachable(seeds));
    const rect = half.rect();
    this.flash = { indices, at: this.time, x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    this.emit({ type: 'wallDone', rect, cells: indices.length });
    this.addPoints(indices.length * POINTS_PER_CELL, rect.x + rect.w / 2, rect.y + rect.h / 2);

    // Shards caught in a filled area are crushed.
    for (const b of this.balls) {
      if (b.kind === 'shard' && this.grid.isSolid(...b.cell())) b.dead = true;
    }

    // Power-ups sealed in (or built through) are collected.
    const collected = this.powerUps.filter((p) => this.grid.isSolid(p.cx, p.cy));
    this.powerUps = this.powerUps.filter((p) => !this.grid.isSolid(p.cx, p.cy));
    for (const p of collected) this.collect(p);
  }

  collect(p: PowerUp): void {
    switch (p.kind) {
      case 'bomb':
        this.bombs = Math.min(MAX_CHARGES, this.bombs + 1);
        break;
      case 'magnet':
        this.magnets = Math.min(MAX_CHARGES, this.magnets + 1);
        break;
      case 'multiplier':
        this.multiplier = Math.min(MAX_MULTIPLIER, this.multiplier + 1);
        this.multiplierUntil = this.time + MULTIPLIER_TIME;
        break;
      case 'fast':
        this.fastUntil = this.time + FAST_TIME;
        break;
      case 'freeze':
        this.freezeUntil = this.time + FREEZE_TIME;
        break;
    }
    const label = p.kind === 'multiplier' ? `×${this.multiplier}` : POWERS[p.kind].label;
    this.popups.push({ x: p.cx * CELL + CELL / 2, y: p.cy * CELL - 6, text: label, at: this.time });
    this.emit({ type: 'collect', x: p.cx * CELL + CELL / 2, y: p.cy * CELL + CELL / 2, kind: p.kind });
  }

  private updatePowerUps(): void {
    this.powerUps = this.powerUps.filter((p) => this.time - p.at < POWERUP_LIFETIME);
    if (!this.autoSpawnPowerUps || this.time < this.nextPowerAt) return;
    this.nextPowerAt = this.time + POWERUP_SPAWN_MIN + this.rng() * (POWERUP_SPAWN_MAX - POWERUP_SPAWN_MIN);
    if (this.powerUps.length < POWERUP_MAX_ON_FIELD) this.spawnPowerUp(randomPower(this.rng));
  }

  /** Place a power-up on a random empty cell away from balls and walls. */
  spawnPowerUp(kind: PowerKind): PowerUp | null {
    const wallCells = new Set(this.halves.flatMap((h) => h.coveredCells().map(([x, y]) => this.grid.index(x, y))));
    for (let attempt = 0; attempt < 60; attempt++) {
      const cx = Math.floor(this.rng() * COLS);
      const cy = Math.floor(this.rng() * ROWS);
      if (this.grid.isSolid(cx, cy) || wallCells.has(this.grid.index(cx, cy))) continue;
      if (this.powerUps.some((p) => p.cx === cx && p.cy === cy)) continue;
      const x = cx * CELL + CELL / 2;
      const y = cy * CELL + CELL / 2;
      if (this.balls.some((b) => Math.hypot(b.x - x, b.y - y) < POWERUP_MIN_BALL_DISTANCE)) continue;
      const p: PowerUp = { kind, cx, cy, at: this.time };
      this.powerUps.push(p);
      return p;
    }
    return null;
  }

  private completeLevel(): void {
    const livesBonus = this.lives * 100 * this.level;
    const fillBonus = Math.floor((this.fillRatio() - this.winFill) * 100) * 50;
    this.score += livesBonus + fillBonus;
    this.result = { livesBonus, fillBonus };
    this.halves = [];
    this.phase = 'levelComplete';
    this.emit({ type: 'levelClear' });
  }

  private spawnBalls(blueprints: BallBlueprint[]): Ball[] {
    const balls: Ball[] = [];
    const margin = CELL * 2;
    for (const bp of blueprints) {
      const r = bp.r ?? KINDS[bp.kind].radius;
      const speed = bp.speed ?? KINDS[bp.kind].speed * this.rules.speedScale;
      for (let attempt = 0; attempt < 200; attempt++) {
        const x = margin + this.rng() * (WIDTH - margin * 2);
        const y = margin + this.rng() * (HEIGHT - margin * 2);
        if (overlapsSolid(this.grid, x, y, r)) continue;
        if (attempt < 150 && balls.some((b) => Math.hypot(b.x - x, b.y - y) < (r + b.r) * 2)) continue;
        // Mostly-diagonal headings with a little jitter so paths don't loop forever.
        const quadrant = Math.floor(this.rng() * 4);
        const angle = Math.PI / 4 + (quadrant * Math.PI) / 2 + (this.rng() - 0.5) * 0.3;
        const ball = new Ball(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, bp.kind);
        ball.r = r;
        ball.speed = speed;
        if (bp.hp !== undefined) ball.hp = bp.hp;
        balls.push(ball);
        break;
      }
    }
    return balls;
  }
}
