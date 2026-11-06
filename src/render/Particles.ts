import { REDUCED_MOTION } from './theme';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
  gravity: number;
  /** Sparks are drawn as short streaks along their velocity. */
  spark: boolean;
}

export interface EmitOptions {
  count: number;
  color: string;
  speed: [number, number];
  life: [number, number];
  size?: [number, number];
  /** Emission direction (radians) and spread; omit for all directions. */
  angle?: number;
  spread?: number;
  drag?: number;
  gravity?: number;
  spark?: boolean;
}

const MAX_PARTICLES = 900;

/** Purely visual particles, drawn additively. */
export class Particles {
  private list: Particle[] = [];

  emit(x: number, y: number, o: EmitOptions): void {
    const count = REDUCED_MOTION ? Math.ceil(o.count / 3) : o.count;
    for (let i = 0; i < count && this.list.length < MAX_PARTICLES; i++) {
      const a = o.angle === undefined ? Math.random() * Math.PI * 2 : o.angle + (Math.random() - 0.5) * (o.spread ?? 0);
      const speed = rand(o.speed);
      const life = rand(o.life);
      this.list.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life,
        max: life,
        size: rand(o.size ?? [1.5, 3]),
        color: o.color,
        drag: o.drag ?? 2.5,
        gravity: o.gravity ?? 0,
        spark: o.spark ?? false,
      });
    }
  }

  /** Emit along a line segment, e.g. a finished wall. */
  emitAlong(x0: number, y0: number, x1: number, y1: number, o: EmitOptions): void {
    const n = o.count;
    for (let i = 0; i < n; i++) {
      const t = Math.random();
      this.emit(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, { ...o, count: 1 });
    }
  }

  update(dt: number): void {
    for (const p of this.list) {
      p.life -= dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.list.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of this.list) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      if (p.spark) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * a), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  clear(): void {
    this.list = [];
  }
}

function rand([lo, hi]: [number, number]): number {
  return lo + Math.random() * (hi - lo);
}
