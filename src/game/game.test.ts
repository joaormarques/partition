import { describe, expect, it } from 'vitest';
import { Ball, KINDS, moveBall } from './Ball';
import { CELL, COLS, ROWS, TICK } from './constants';
import { Game, SHATTER_POINTS } from './Game';
import { BOMB_POINTS_PER_BALL, FREEZE_TIME, POWERUP_LIFETIME, randomPower } from './PowerUps';
import { MAX_BALLS, newKindAt, unlockedKinds } from './levels';
import { EMPTY, FILLED, Grid } from './Grid';
import { WallHalf } from './Wall';

const center = (c: number) => c * CELL + CELL / 2;

function fillColumn(grid: Grid, x: number): void {
  for (let y = 0; y < grid.rows; y++) grid.set(x, y, FILLED);
}

/** A game in the playing phase with the given balls instead of random ones. */
function seededRng(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

function setup(balls: Ball[]): Game {
  const game = new Game(seededRng());
  game.startLevel();
  game.balls = balls;
  game.autoSpawnPowerUps = false;
  return game;
}

function runUntilWallResolves(game: Game, maxTicks = 5000): void {
  for (let i = 0; i < maxTicks && game.halves.length > 0 && game.phase === 'playing'; i++) {
    game.update(TICK);
  }
}

describe('Grid.fillUnreachable', () => {
  it('fills only the regions without a seed', () => {
    const grid = new Grid(10, 4);
    fillColumn(grid, 4);
    const filled = grid.fillUnreachable([[1, 1]]);
    expect(filled).toHaveLength(5 * 4);
    expect(grid.get(0, 0)).toBe(EMPTY);
    expect(grid.get(9, 3)).toBe(FILLED);
  });

  it('keeps every region that holds a seed', () => {
    const grid = new Grid(10, 4);
    fillColumn(grid, 4);
    expect(grid.fillUnreachable([[1, 1], [8, 2]])).toHaveLength(0);
  });

  it('treats out-of-bounds as solid', () => {
    const grid = new Grid(3, 3);
    expect(grid.isSolid(-1, 0)).toBe(true);
    expect(grid.isSolid(0, 3)).toBe(true);
  });
});

describe('WallHalf', () => {
  it('grows until it reaches a solid cell and then stops', () => {
    const grid = new Grid(10, 1);
    grid.set(7, 0, FILLED);
    const half = new WallHalf(2, 0, 'h', 1); // starts at x=3, grows right
    for (let i = 0; i < 100; i++) half.grow(grid, 10, 0.1);
    expect(half.state).toBe('done');
    expect(half.coveredCells()).toEqual([[3, 0], [4, 0], [5, 0], [6, 0]]);
    expect(half.progress).toBe(4);
  });

  it('finishes immediately with zero length when its first cell is solid', () => {
    const grid = new Grid(5, 1);
    grid.set(3, 0, FILLED);
    const half = new WallHalf(2, 0, 'h', 1);
    half.grow(grid, 10, TICK);
    expect(half.state).toBe('done');
    expect(half.coveredCells()).toEqual([]);
  });

  it('negative half includes the origin and grows toward zero', () => {
    const grid = new Grid(1, 6);
    const half = new WallHalf(0, 3, 'v', -1);
    for (let i = 0; i < 100; i++) half.grow(grid, 10, 0.1);
    expect(half.coveredCells()).toEqual([[0, 3], [0, 2], [0, 1], [0, 0]]);
  });
});

describe('ball movement', () => {
  it('does not tunnel through a one-cell wall at extreme speed', () => {
    const grid = new Grid(COLS, ROWS);
    fillColumn(grid, 10);
    const ball = new Ball(center(5), center(5), 5000, 37);
    for (let i = 0; i < 240; i++) {
      moveBall(ball, grid, TICK);
      expect(ball.x + ball.r).toBeLessThanOrEqual(10 * CELL);
      expect(ball.x - ball.r).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps balls inside the field', () => {
    const grid = new Grid(COLS, ROWS);
    const ball = new Ball(center(1), center(1), -300, -300);
    for (let i = 0; i < 600; i++) moveBall(ball, grid, TICK);
    expect(ball.x).toBeGreaterThanOrEqual(ball.r);
    expect(ball.y).toBeGreaterThanOrEqual(ball.r);
  });
});

describe('Game', () => {
  it('a completed wall seals off and fills the empty side', () => {
    const game = setup([new Ball(center(5), center(10), 0, 0)]);
    game.orientation = 'v';
    expect(game.placeWall(20, 5)).toBe(true);
    runUntilWallResolves(game);

    expect(game.lives).toBe(2);
    expect(game.grid.get(20, 0)).toBe(FILLED);
    expect(game.grid.get(20, ROWS - 1)).toBe(FILLED);
    expect(game.grid.get(30, 10)).toBe(FILLED);
    expect(game.grid.get(5, 10)).toBe(EMPTY);
    expect(game.fillRatio()).toBeCloseTo(28 / 48);
    expect(game.score).toBe(28 * ROWS * 10);
    expect(game.phase).toBe('playing');
  });

  it('a ball hitting a growing half breaks only that half and costs a life', () => {
    const game = setup([new Ball(center(20), center(20), 0, 0)]);
    game.orientation = 'v';
    game.placeWall(20, 5);
    runUntilWallResolves(game);

    expect(game.lives).toBe(1);
    // The upper half still completed.
    expect(game.grid.get(20, 0)).toBe(FILLED);
    expect(game.grid.get(20, 5)).toBe(FILLED);
    // The lower half was destroyed, so nothing below was committed.
    expect(game.grid.get(20, 6)).toBe(EMPTY);
  });

  it('only one wall can build at a time and not on filled cells', () => {
    const game = setup([new Ball(center(5), center(10), 0, 0)]);
    game.grid.set(30, 30, FILLED);
    expect(game.placeWall(30, 30)).toBe(false);
    expect(game.placeWall(20, 5)).toBe(true);
    expect(game.placeWall(25, 5)).toBe(false);
  });

  it('runs out of lives into game over', () => {
    const game = setup([new Ball(center(20), center(20), 0, 0)]);
    game.lives = 1;
    game.orientation = 'v';
    game.placeWall(20, 5);
    runUntilWallResolves(game);
    expect(game.phase).toBe('gameOver');
  });

  it('clears the level at 75% filled and awards bonuses', () => {
    const game = setup([new Ball(center(2), center(10), 0, 0)]);
    for (let x = 13; x < COLS; x++) fillColumn(game.grid, x);
    game.orientation = 'v';
    game.placeWall(12, 10);
    runUntilWallResolves(game);

    expect(game.phase).toBe('levelComplete');
    expect(game.result).toEqual({ livesBonus: 2 * 100 * 1, fillBonus: 0 });

    game.nextLevel();
    expect(game.level).toBe(2);
    expect(game.balls).toHaveLength(3);
    expect(game.balls.some((b) => b.kind === 'heavy')).toBe(true);
    expect(game.lives).toBe(3);
    expect(game.fillRatio()).toBe(0);
  });
});

describe('ball kinds', () => {
  it('heavy balls accelerate downward', () => {
    const grid = new Grid(COLS, ROWS);
    const ball = new Ball(center(20), center(5), 60, 0, 'heavy');
    for (let i = 0; i < 30; i++) moveBall(ball, grid, TICK);
    expect(ball.vy).toBeGreaterThan(50);
    expect(ball.y).toBeGreaterThan(center(5));
  });

  it('heavy balls keep bouncing instead of settling', () => {
    const grid = new Grid(COLS, ROWS);
    const ball = new Ball(center(20), center(28), 60, 0, 'heavy');
    let minY = Infinity;
    for (let i = 0; i < 120 * 10; i++) {
      moveBall(ball, grid, TICK);
      if (i > 120 * 8) minY = Math.min(minY, ball.y);
    }
    // Still clearing at least a few cells off the floor after 8 seconds.
    expect(ROWS * CELL - minY).toBeGreaterThan(CELL * 3);
  });

  it('phantoms pass through filled cells but stay inside the field', () => {
    const grid = new Grid(COLS, ROWS);
    fillColumn(grid, 10);
    const ball = new Ball(center(5), center(5), 200, 0, 'phantom');
    let crossed = false;
    for (let i = 0; i < 240; i++) {
      moveBall(ball, grid, TICK);
      if (ball.x > 11 * CELL) crossed = true;
      expect(ball.x + ball.r).toBeLessThanOrEqual(COLS * CELL);
    }
    expect(crossed).toBe(true);
  });

  it('a region holding only a phantom gets filled', () => {
    const game = setup([new Ball(center(5), center(10), 0, 0), new Ball(center(30), center(10), 0, 0, 'phantom')]);
    game.orientation = 'v';
    game.placeWall(20, 2);
    runUntilWallResolves(game);
    expect(game.grid.get(30, 10)).toBe(FILLED);
    expect(game.balls.some((b) => b.kind === 'phantom')).toBe(true);
  });

  it('a phantom inside a filled area can still break a growing wall', () => {
    const game = setup([new Ball(center(5), center(10), 0, 0)]);
    for (let x = 30; x < COLS; x++) fillColumn(game.grid, x);
    // Phantom sitting in the filled area, right where a horizontal wall will end.
    game.balls.push(new Ball(center(30), center(10), 0, 0, 'phantom'));
    game.orientation = 'h';
    game.placeWall(28, 10);
    runUntilWallResolves(game);
    expect(game.lives).toBe(1);
  });

  it('glass shatters after enough bounces, scoring points and releasing shards', () => {
    const game = setup([new Ball(center(5), center(5), 0, 0)]);
    // Box it into a 4-cell-wide corridor so it bounces often.
    fillColumn(game.grid, 39);
    for (let x = 44; x < COLS; x++) fillColumn(game.grid, x);
    const glass = new Ball(center(41), center(16), 300, 0, 'glass');
    game.balls.push(glass);
    let sawShards = false;
    for (let i = 0; i < 120 * 5; i++) {
      game.update(TICK);
      if (game.balls.some((b) => b.kind === 'shard')) sawShards = true;
    }
    expect(game.balls.some((b) => b.kind === 'glass')).toBe(false);
    expect(sawShards).toBe(true);
    expect(game.score).toBe(SHATTER_POINTS);
    // Shards expire.
    expect(game.balls.some((b) => b.kind === 'shard')).toBe(false);
  });

  it('a splitter that breaks a wall splits into two smaller, faster balls', () => {
    const game = setup([new Ball(center(20), center(20), 0, 0, 'splitter')]);
    game.orientation = 'v';
    game.placeWall(20, 5);
    runUntilWallResolves(game);
    expect(game.lives).toBe(1);
    expect(game.balls).toHaveLength(2);
    for (const b of game.balls) {
      expect(b.kind).toBe('basic');
      expect(b.r).toBeLessThan(KINDS.splitter.radius);
      expect(b.speed).toBeGreaterThan(KINDS.basic.speed);
    }
  });
});

describe('levels and carry-over', () => {
  it('unlocks kinds by level', () => {
    expect(unlockedKinds(1)).toEqual(['basic']);
    expect(unlockedKinds(3)).toEqual(['basic', 'heavy', 'glass']);
    expect(newKindAt(5)).toBe('phantom');
    expect(newKindAt(6)).toBeNull();
  });

  it('carries surviving balls (with their size and damage) into the next level', () => {
    const game = setup([new Ball(center(2), center(10), 0, 0, 'glass'), new Ball(center(4), center(10), 0, 0)]);
    game.balls[0].hp = 2;
    game.balls[1].r = 5;
    game.level = 2;
    game.nextLevel();

    expect(game.level).toBe(3);
    expect(game.balls.filter((b) => b.kind === 'glass').length).toBeGreaterThanOrEqual(2); // carried + newly unlocked
    expect(game.balls.some((b) => b.kind === 'glass' && b.hp === 2)).toBe(true);
    expect(game.balls.some((b) => b.kind === 'basic' && b.r === 5)).toBe(true);
    expect(game.balls.length).toBe(4);
    expect(game.intro?.subtitle).toContain('Glass');
  });

  it('never exceeds the ball cap', () => {
    const many = Array.from({ length: MAX_BALLS }, (_, i) => new Ball(center(2 + i * 2), center(10), 0, 0));
    const game = setup(many);
    game.nextLevel();
    expect(game.balls.length).toBe(MAX_BALLS);
  });
});

describe('power-ups', () => {
  it('is collected when its cell is sealed into a filled area', () => {
    const game = setup([new Ball(center(5), center(10), 0, 0)]);
    game.powerUps.push({ kind: 'multiplier', cx: 30, cy: 12, at: 0 });
    game.orientation = 'v';
    game.placeWall(20, 5);
    runUntilWallResolves(game);
    expect(game.powerUps).toHaveLength(0);
    expect(game.multiplier).toBe(2);
  });

  it('stays on the field if its region still holds a ball', () => {
    const game = setup([new Ball(center(5), center(10), 0, 0)]);
    game.powerUps.push({ kind: 'bomb', cx: 8, cy: 12, at: 0 });
    game.orientation = 'v';
    game.placeWall(20, 5);
    runUntilWallResolves(game);
    expect(game.powerUps).toHaveLength(1);
    expect(game.bombs).toBe(0);
  });

  it('the multiplier scales points earned while it is active', () => {
    const plain = setup([new Ball(center(5), center(10), 0, 0)]);
    plain.orientation = 'v';
    plain.placeWall(20, 5);
    runUntilWallResolves(plain);

    const boosted = setup([new Ball(center(5), center(10), 0, 0)]);
    boosted.collect({ kind: 'multiplier', cx: 0, cy: 0, at: 0 });
    boosted.collect({ kind: 'multiplier', cx: 0, cy: 0, at: 0 });
    boosted.orientation = 'v';
    boosted.placeWall(20, 5);
    runUntilWallResolves(boosted);

    expect(boosted.multiplier).toBe(3);
    expect(boosted.score).toBe(plain.score * 3);
  });

  it('the multiplier wears off', () => {
    const game = setup([new Ball(center(5), center(10), 0, 0)]);
    game.collect({ kind: 'multiplier', cx: 0, cy: 0, at: 0 });
    for (let i = 0; i < 120 * 11; i++) game.update(TICK);
    expect(game.multiplier).toBe(1);
  });

  it('a held bomb turns the next click into a blast that destroys nearby balls', () => {
    const near = new Ball(center(20), center(10), 0, 0);
    const far = new Ball(center(40), center(25), 0, 0);
    const game = setup([near, far]);
    game.collect({ kind: 'bomb', cx: 0, cy: 0, at: 0 });
    expect(game.click(21, 11)).toBe(true);
    expect(game.bombs).toBe(0);
    expect(game.halves).toHaveLength(0);
    expect(game.balls).toEqual([far]);
    expect(game.score).toBe(BOMB_POINTS_PER_BALL);
    // The next click builds a wall again.
    expect(game.click(30, 5)).toBe(true);
    expect(game.halves).toHaveLength(2);
  });

  it('a magnetic wall turns away a ball that would have broken it', () => {
    const run = (magnet: boolean) => {
      const game = setup([new Ball(center(23), center(15), -160, 0)]);
      if (magnet) game.collect({ kind: 'magnet', cx: 0, cy: 0, at: 0 });
      game.orientation = 'v';
      game.placeWall(20, 15);
      runUntilWallResolves(game);
      return game;
    };
    expect(run(false).lives).toBe(1);
    const magnetic = run(true);
    expect(magnetic.lives).toBe(2);
    expect(magnetic.magnets).toBe(0);
  });

  it('fast walls finish sooner', () => {
    const ticksToFinish = (fast: boolean) => {
      const game = setup([new Ball(center(5), center(10), 0, 0)]);
      if (fast) game.collect({ kind: 'fast', cx: 0, cy: 0, at: 0 });
      game.orientation = 'v';
      game.placeWall(20, 5);
      let ticks = 0;
      while (game.halves.length > 0 && ticks < 5000) {
        game.update(TICK);
        ticks++;
      }
      return ticks;
    };
    expect(ticksToFinish(true)).toBeLessThan(ticksToFinish(false) * 0.6);
  });

  it('freeze stops balls, then they move again', () => {
    const ball = new Ball(center(10), center(10), 160, 0);
    const game = setup([ball]);
    game.collect({ kind: 'freeze', cx: 0, cy: 0, at: 0 });
    const x0 = ball.x;
    for (let i = 0; i < 120; i++) game.update(TICK);
    expect(ball.x).toBe(x0);
    for (let i = 0; i < 120 * FREEZE_TIME; i++) game.update(TICK);
    expect(ball.x).toBeGreaterThan(x0);
  });

  it('spawns on empty cells, never more than two at once, and they expire', () => {
    const game = setup([new Ball(center(5), center(10), 0, 0)]);
    game.autoSpawnPowerUps = true;
    game.nextPowerAt = 0;
    let max = 0;
    for (let i = 0; i < 120 * 30; i++) {
      game.update(TICK);
      max = Math.max(max, game.powerUps.length);
      for (const p of game.powerUps) {
        expect(game.grid.isSolid(p.cx, p.cy)).toBe(false);
        expect(game.time - p.at).toBeLessThan(POWERUP_LIFETIME);
      }
    }
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(2);
  });

  it('bomb and magnet charges carry into the next level; timed effects do not', () => {
    const game = setup([new Ball(center(5), center(10), 0, 0)]);
    game.collect({ kind: 'bomb', cx: 0, cy: 0, at: 0 });
    game.collect({ kind: 'magnet', cx: 0, cy: 0, at: 0 });
    game.collect({ kind: 'multiplier', cx: 0, cy: 0, at: 0 });
    game.nextLevel();
    expect(game.bombs).toBe(1);
    expect(game.magnets).toBe(1);
    expect(game.multiplier).toBe(1);
  });

  it('random power picks cover every kind', () => {
    const rng = seededRng(7);
    const seen = new Set(Array.from({ length: 200 }, () => randomPower(rng)));
    expect(seen.size).toBe(5);
  });
});

describe('edge cases', () => {
  it('a wall started right on top of a ball breaks almost immediately', () => {
    const game = setup([new Ball(center(20), center(10), 0, 0)]);
    game.orientation = 'v';
    game.placeWall(20, 10);
    // Within a couple of 120 Hz ticks: the hit check runs before each growth step.
    for (let i = 0; i < 3; i++) game.update(TICK);
    expect(game.lives).toBe(1);
  });

  it('two halves finishing on the same tick are both committed once', () => {
    const game = setup([new Ball(center(5), center(10), 0, 0)]);
    game.orientation = 'v';
    game.placeWall(20, 15); // 16 cells each way on a 32-row board
    let sawOneHalf = false;
    for (let i = 0; i < 5000 && game.halves.length > 0; i++) {
      game.update(TICK);
      if (game.halves.length === 1) sawOneHalf = true;
    }
    expect(sawOneHalf).toBe(false);
    expect(game.lives).toBe(2);
    expect(game.fillRatio()).toBeCloseTo(28 / 48);
    expect(game.score).toBe(28 * ROWS * 10);
  });

  it('a wall cannot start while another is building, even with a bomb-free click', () => {
    const game = setup([new Ball(center(5), center(10), 0, 0)]);
    expect(game.click(20, 5)).toBe(true);
    expect(game.click(30, 5)).toBe(false);
  });
});

describe('difficulty', () => {
  it('relaxed gives extra lives, slower balls and a lower target', () => {
    const game = new Game(seededRng());
    game.difficulty = 'relaxed';
    game.startNewGame();
    expect(game.lives).toBe(4);
    expect(game.winFill).toBe(0.7);
    for (const b of game.balls) expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(KINDS.basic.speed * 0.8);
  });

  it('hard never drops below one life and speeds balls up', () => {
    const game = new Game(seededRng());
    game.difficulty = 'hard';
    game.startNewGame();
    expect(game.lives).toBe(1);
    expect(game.winFill).toBe(0.8);
    for (const b of game.balls) expect(b.speed).toBeCloseTo(KINDS.basic.speed * 1.2);
  });

  it('clears at the difficulty target, not the default', () => {
    const game = new Game(seededRng());
    game.difficulty = 'relaxed';
    game.startNewGame();
    game.autoSpawnPowerUps = false;
    game.balls = [new Ball(center(2), center(10), 0, 0)];
    for (let x = 16; x < COLS; x++) fillColumn(game.grid, x); // 32/48 ≈ 67%
    game.orientation = 'v';
    game.placeWall(15, 10); // → 33/48 ≈ 69%: not yet
    runUntilWallResolves(game);
    expect(game.phase).toBe('playing');
    game.placeWall(14, 10); // → 34/48 ≈ 71%
    runUntilWallResolves(game);
    expect(game.phase).toBe('levelComplete');
  });

  it('changing difficulty mid-game waits for the next game', () => {
    const game = new Game(seededRng());
    game.startNewGame();
    game.difficulty = 'hard';
    expect(game.winFill).toBe(0.75);
    game.nextLevel();
    expect(game.winFill).toBe(0.75);
    game.startNewGame();
    expect(game.winFill).toBe(0.8);
  });
});
