import type { Ball, Rect } from '../game/Ball';
import { CELL, HEIGHT, WIDTH } from '../game/constants';
import type { Game, GameEvent } from '../game/Game';
import { BOMB_RADIUS, MAGNET_RANGE, POWERUP_LIFETIME } from '../game/PowerUps';
import type { WallHalf } from '../game/Wall';
import { BackgroundLayer, FieldLayer } from './layers';
import { drawIntro, drawOverlay, type OverlayInfo } from './overlays';
import { Particles } from './Particles';
import { drawBall, drawPowerIcon } from './sprites';
import { BALL_COLORS, FONT, POWER_COLORS, REDUCED_MOTION, T } from './theme';

const WAVE_SPEED = 1100; // px/s the fill wave travels from the wall
const WAVE_FLASH = 0.35; // s each cell glows once the wave reaches it
const TRAIL_LENGTH = 7;
const GHOST_TIME = 0.45;

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private readonly bg = new BackgroundLayer();
  private readonly field = new FieldLayer();
  private readonly particles = new Particles();
  private trails = new WeakMap<Ball, Array<[number, number]>>();
  private ghosts: Array<{ rect: Rect; at: number }> = [];
  private shake = 0;
  /** Real seconds since start; drives effects that run outside play (overlays, particles). */
  private clock = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = WIDTH * this.dpr;
    this.canvas.height = HEIGHT * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw(game: Game, hover: [number, number] | null, dt: number, info: OverlayInfo): void {
    this.clock += dt;
    if (game.phase !== 'paused') this.particles.update(dt);
    this.shake = REDUCED_MOTION ? 0 : this.shake * Math.exp(-dt * 9);

    const { ctx } = this;
    ctx.save();
    if (this.shake > 0.3) {
      ctx.translate((Math.random() - 0.5) * 2 * this.shake, (Math.random() - 0.5) * 2 * this.shake);
    }
    const bg = this.bg.get(this.dpr);
    ctx.drawImage(bg, 0, 0, WIDTH, HEIGHT);
    ctx.drawImage(this.field.get(game.grid, this.dpr), 0, 0, WIDTH, HEIGHT);
    this.drawFillWave(game, bg);
    ctx.strokeStyle = T.frame;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, WIDTH - 1, HEIGHT - 1);

    this.drawPowerUps(game);
    this.drawGhosts();
    this.drawWalls(game);
    this.drawBalls(game);
    this.drawBursts(game);
    this.particles.draw(ctx);
    if (game.phase === 'playing' && hover) {
      if (game.bombs > 0) this.drawBombPreview(hover);
      else if (game.halves.length === 0) this.drawPreview(game, hover);
    }
    this.drawPopups(game);
    ctx.restore();

    this.drawDangerFlash(game);
    drawIntro(ctx, game);
    drawOverlay(ctx, game, this.clock, info);
  }

  // ── Events → particles and shake ──────────────────────────────────────────

  handle(events: readonly GameEvent[]): void {
    for (const e of events) this.onEvent(e);
  }

  private onEvent(e: GameEvent): void {
    const p = this.particles;
    switch (e.type) {
      case 'wallDone': {
        const { rect } = e;
        const vertical = rect.h > rect.w;
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const len = Math.max(rect.w, rect.h);
        const [x0, y0, x1, y1] = vertical ? [cx, rect.y, cx, rect.y + rect.h] : [rect.x, cy, rect.x + rect.w, cy];
        p.emitAlong(x0, y0, x1, y1, {
          count: Math.min(60, Math.ceil(len / 8)),
          color: T.edge,
          speed: [30, 140],
          life: [0.3, 0.7],
          size: [1, 2],
          spark: true,
        });
        if (e.cells > 300) this.shake = Math.max(this.shake, 2.5);
        break;
      }
      case 'wallBreak': {
        this.ghosts.push({ rect: e.rect, at: this.clock });
        const red = `rgb(${T.danger.join(',')})`;
        p.emit(e.x, e.y, { count: 28, color: red, speed: [80, 320], life: [0.25, 0.6], size: [1.5, 2.5], spark: true });
        p.emit(e.x, e.y, { count: 10, color: '#ffd0a0', speed: [20, 90], life: [0.3, 0.5], size: [2, 3.5] });
        this.shake = Math.max(this.shake, 7);
        break;
      }
      case 'shatter':
        p.emit(e.x, e.y, { count: 22, color: BALL_COLORS.glass, speed: [60, 260], life: [0.3, 0.8], size: [1, 2], spark: true });
        p.emit(e.x, e.y, { count: 8, color: '#ffffff', speed: [10, 60], life: [0.2, 0.4], size: [1.5, 2.5] });
        break;
      case 'bomb':
        p.emit(e.x, e.y, { count: 70, color: '#ffae5c', speed: [120, 480], life: [0.3, 0.8], size: [1.5, 3], spark: true });
        p.emit(e.x, e.y, { count: 30, color: '#ff6a3d', speed: [20, 140], life: [0.4, 0.9], size: [2.5, 5] });
        this.shake = Math.max(this.shake, 12);
        break;
      case 'collect': {
        const color = POWER_COLORS[e.kind];
        p.emit(e.x, e.y, { count: 26, color, speed: [60, 200], life: [0.35, 0.7], size: [1.5, 2.5] });
        break;
      }
      case 'levelClear':
        for (let i = 0; i < 14; i++) {
          p.emit(Math.random() * WIDTH, Math.random() * HEIGHT, {
            count: 10,
            color: i % 2 ? T.edge : T.accent,
            speed: [40, 200],
            life: [0.6, 1.4],
            size: [1.5, 3],
            gravity: 60,
          });
        }
        break;
      case 'gameOver':
        this.shake = Math.max(this.shake, 10);
        break;
    }
  }

  // ── Field ─────────────────────────────────────────────────────────────────

  /** Newly filled cells are revealed by a wave travelling out from the wall. */
  private drawFillWave(game: Game, bg: HTMLCanvasElement): void {
    const { flash, grid } = game;
    // Game time stops between levels; show the finished board rather than a frozen wave.
    if (game.phase !== 'playing' && game.phase !== 'paused') return;
    const elapsed = game.time - flash.at;
    if (elapsed < 0 || elapsed > 2.5 || flash.indices.length === 0) return;
    const { ctx, dpr } = this;
    const [r, g, b] = T.wave;
    for (const i of flash.indices) {
      const x = (i % grid.cols) * CELL;
      const y = ((i / grid.cols) | 0) * CELL;
      const d = Math.hypot(x + CELL / 2 - flash.x, y + CELL / 2 - flash.y);
      const local = elapsed - d / WAVE_SPEED;
      if (local < 0) {
        // Not reached yet: still looks like open board.
        ctx.drawImage(bg, x * dpr, y * dpr, CELL * dpr, CELL * dpr, x, y, CELL, CELL);
      } else if (local < WAVE_FLASH) {
        ctx.fillStyle = `rgba(${r},${g},${b},${(1 - local / WAVE_FLASH) * 0.55})`;
        ctx.fillRect(x, y, CELL, CELL);
      }
    }
  }

  private drawPowerUps(game: Game): void {
    for (const p of game.powerUps) {
      const age = game.time - p.at;
      const left = POWERUP_LIFETIME - age;
      if (left < 3 && Math.floor(left * 6) % 2 === 0) continue; // blink before vanishing
      const pop = Math.min(1, age / 0.25); // grow in
      drawPowerIcon(this.ctx, p.kind, p.cx * CELL + CELL / 2, p.cy * CELL + CELL / 2, game.time, pop);
    }
  }

  // ── Walls ─────────────────────────────────────────────────────────────────

  private drawWalls(game: Game): void {
    const { ctx } = this;
    for (const half of game.halves) {
      if (!half.magnetic) continue;
      const r = half.rect();
      const a = 0.1 + 0.05 * Math.sin(this.clock * 8);
      ctx.fillStyle = `rgba(255,90,120,${a})`;
      ctx.fillRect(r.x - MAGNET_RANGE, r.y - MAGNET_RANGE, r.w + MAGNET_RANGE * 2, r.h + MAGNET_RANGE * 2);
    }
    for (const half of game.halves) this.drawBeam(half, game);
  }

  private drawBeam(half: WallHalf, game: Game): void {
    const { ctx } = this;
    const r = half.rect();
    if (r.w <= 0 || r.h <= 0) return;
    const color = half.dir === -1 ? T.wallNeg : T.wallPos;
    const vertical = half.orient === 'v';
    const band = (thickness: number): [number, number, number, number] =>
      vertical
        ? [r.x + (CELL - thickness) / 2, r.y, thickness, r.h]
        : [r.x, r.y + (CELL - thickness) / 2, r.w, thickness];

    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = color;
    ctx.fillRect(...band(CELL));
    ctx.globalAlpha = 1;
    ctx.fillRect(...band(6));
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(...band(2));
    ctx.restore();

    // Bright growing tip, shedding sparks.
    const tip: [number, number] = vertical
      ? [r.x + CELL / 2, half.dir === -1 ? r.y : r.y + r.h]
      : [half.dir === -1 ? r.x : r.x + r.w, r.y + CELL / 2];
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(tip[0], tip[1], 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (game.phase === 'playing' && Math.random() < 0.6) {
      this.particles.emit(tip[0], tip[1], { count: 1, color, speed: [30, 110], life: [0.15, 0.35], size: [1, 2], spark: true });
    }
  }

  private drawGhosts(): void {
    const { ctx } = this;
    this.ghosts = this.ghosts.filter((g) => this.clock - g.at < GHOST_TIME);
    const [r, g, b] = T.danger;
    for (const ghost of this.ghosts) {
      const t = (this.clock - ghost.at) / GHOST_TIME;
      const flicker = Math.floor(t * 12) % 2 === 0 ? 1 : 0.5;
      const a = (1 - t) * flicker;
      const { x, y, w, h } = ghost.rect;
      const vertical = h > w;
      // Faint full-width band plus a thin core, like the beam it replaced.
      ctx.fillStyle = `rgba(${r},${g},${b},${a * 0.18})`;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = `rgba(${r},${g},${b},${a * 0.9})`;
      if (vertical) ctx.fillRect(x + (CELL - 4) / 2, y, 4, h);
      else ctx.fillRect(x, y + (CELL - 4) / 2, w, 4);
    }
  }

  // ── Balls ─────────────────────────────────────────────────────────────────

  private drawBalls(game: Game): void {
    const { ctx } = this;
    const frozen = game.frozen;
    for (const b of game.balls) {
      if (!REDUCED_MOTION && b.kind !== 'shard') this.drawTrail(b, !frozen && game.phase === 'playing');
      drawBall(ctx, b, game.time);
    }
    if (frozen) {
      ctx.strokeStyle = 'rgba(170,225,255,0.9)';
      ctx.lineWidth = 2;
      for (const b of game.balls) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawTrail(b: Ball, record: boolean): void {
    let trail = this.trails.get(b);
    if (!trail) {
      trail = [];
      this.trails.set(b, trail);
    }
    if (record) {
      const last = trail[trail.length - 1];
      if (last && Math.hypot(last[0] - b.x, last[1] - b.y) > 40) trail.length = 0; // teleported (new level)
      trail.push([b.x, b.y]);
      if (trail.length > TRAIL_LENGTH) trail.shift();
    }
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = BALL_COLORS[b.kind];
    trail.forEach(([x, y], i) => {
      const k = (i + 1) / trail!.length;
      ctx.globalAlpha = k * 0.18;
      ctx.beginPath();
      ctx.arc(x, y, b.r * (0.4 + 0.5 * k), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  private drawBursts(game: Game): void {
    const { ctx } = this;
    for (const s of game.bursts) {
      const dur = s.kind === 'bomb' ? 0.55 : 0.4;
      const t = (game.time - s.at) / dur;
      if (t < 0 || t >= 1) continue;
      if (s.kind === 'bomb') {
        ctx.fillStyle = `rgba(255,150,80,${(1 - t) * 0.3})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius * (0.4 + 0.6 * t), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = s.kind === 'bomb' ? `rgba(255,190,110,${1 - t})` : `rgba(160,235,255,${(1 - t) * 0.9})`;
      ctx.lineWidth = s.kind === 'bomb' ? 3 : 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6 + t * (s.radius - 6), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ── Cursor previews ───────────────────────────────────────────────────────

  private drawPreview(game: Game, [cx, cy]: [number, number]): void {
    const { grid } = game;
    if (grid.isSolid(cx, cy)) return;
    const { ctx } = this;
    const h = game.orientation === 'h';

    // Where each half would stop.
    let lo = h ? cx : cy;
    while (!(h ? grid.isSolid(lo - 1, cy) : grid.isSolid(cx, lo - 1))) lo--;
    let hi = h ? cx : cy;
    while (!(h ? grid.isSolid(hi + 1, cy) : grid.isSolid(cx, hi + 1))) hi++;

    if (game.magnets > 0) {
      ctx.fillStyle = 'rgba(255,90,120,0.1)';
      if (h) ctx.fillRect(lo * CELL - MAGNET_RANGE, cy * CELL - MAGNET_RANGE, (hi - lo + 1) * CELL + MAGNET_RANGE * 2, CELL + MAGNET_RANGE * 2);
      else ctx.fillRect(cx * CELL - MAGNET_RANGE, lo * CELL - MAGNET_RANGE, CELL + MAGNET_RANGE * 2, (hi - lo + 1) * CELL + MAGNET_RANGE * 2);
    }

    const mid = (h ? cy : cx) * CELL + CELL / 2;
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(220,240,255,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (h) {
      ctx.moveTo(lo * CELL, mid);
      ctx.lineTo((hi + 1) * CELL, mid);
    } else {
      ctx.moveTo(mid, lo * CELL);
      ctx.lineTo(mid, (hi + 1) * CELL);
    }
    ctx.stroke();
    ctx.restore();

    const x = cx * CELL + CELL / 2;
    const y = cy * CELL + CELL / 2;
    const len = CELL * 1.6;
    ctx.strokeStyle = T.preview;
    ctx.fillStyle = T.preview;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (h) {
      ctx.moveTo(x - len, y);
      ctx.lineTo(x + len, y);
    } else {
      ctx.moveTo(x, y - len);
      ctx.lineTo(x, y + len);
    }
    ctx.stroke();
    this.arrowHeads(x, y, len, h);
    ctx.strokeRect(cx * CELL + 1, cy * CELL + 1, CELL - 2, CELL - 2);
  }

  private arrowHeads(x: number, y: number, len: number, horizontal: boolean): void {
    const { ctx } = this;
    const s = 4;
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(x - len - s, y);
      ctx.lineTo(x - len + s, y - s);
      ctx.lineTo(x - len + s, y + s);
      ctx.moveTo(x + len + s, y);
      ctx.lineTo(x + len - s, y - s);
      ctx.lineTo(x + len - s, y + s);
    } else {
      ctx.moveTo(x, y - len - s);
      ctx.lineTo(x - s, y - len + s);
      ctx.lineTo(x + s, y - len + s);
      ctx.moveTo(x, y + len + s);
      ctx.lineTo(x - s, y + len - s);
      ctx.lineTo(x + s, y + len - s);
    }
    ctx.fill();
  }

  private drawBombPreview([cx, cy]: [number, number]): void {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = -this.clock * 20;
    ctx.strokeStyle = 'rgba(255,120,90,0.9)';
    ctx.fillStyle = 'rgba(255,110,90,0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx * CELL + CELL / 2, cy * CELL + CELL / 2, BOMB_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ── Text and screen effects ───────────────────────────────────────────────

  private drawPopups(game: Game): void {
    if (game.phase !== 'playing' && game.phase !== 'paused') return;
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 15px ${FONT}`;
    ctx.lineJoin = 'round';
    for (const p of game.popups) {
      const t = (game.time - p.at) / 1.0;
      if (t < 0 || t >= 1) continue;
      const y = p.y - 30 * (1 - (1 - t) * (1 - t)); // ease out
      ctx.globalAlpha = t < 0.7 ? 1 : (1 - t) / 0.3;
      ctx.strokeStyle = 'rgba(4,7,15,0.85)';
      ctx.lineWidth = 4;
      ctx.strokeText(p.text, p.x, y);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText(p.text, p.x, y);
    }
    ctx.globalAlpha = 1;
  }

  /** Red glow around the edge right after losing a life. */
  private drawDangerFlash(game: Game): void {
    const t = (game.time - game.lastBreakAt) / 0.5;
    if (t < 0 || t >= 1) return;
    const { ctx } = this;
    const [r, g, b] = T.danger;
    const a = (1 - t) * 0.55;
    const edge = 70;
    const sides: Array<[number, number, number, number, number, number, number, number]> = [
      [0, 0, WIDTH, edge, 0, 0, 0, edge],
      [0, HEIGHT - edge, WIDTH, edge, 0, HEIGHT, 0, HEIGHT - edge],
      [0, 0, edge, HEIGHT, 0, 0, edge, 0],
      [WIDTH - edge, 0, edge, HEIGHT, WIDTH, 0, WIDTH - edge, 0],
    ];
    for (const [x, y, w, h, gx0, gy0, gx1, gy1] of sides) {
      const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      grad.addColorStop(0, `rgba(${r},${g},${b},${a})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
    }
  }
}
