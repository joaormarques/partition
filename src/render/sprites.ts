import { type Ball, KINDS } from '../game/Ball';
import type { PowerKind } from '../game/PowerUps';
import { POWER_COLORS } from './theme';

function shadedDisc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, light: string, dark: string): void {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function halo(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.2);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Draw a ball of any kind. `time` drives the phantom's pulse. */
export function drawBall(ctx: CanvasRenderingContext2D, b: Ball, time: number): void {
  const { x, y, r } = b;
  switch (b.kind) {
    case 'basic':
      halo(ctx, x, y, r, 'rgba(200,225,255,1)', 0.18);
      shadedDisc(ctx, x, y, r, '#ffffff', '#8a97b3');
      break;
    case 'heavy':
      shadedDisc(ctx, x, y, r, '#a9b2c4', '#2e3546');
      ctx.strokeStyle = '#d5dbe6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r - 0.75, 0, Math.PI * 2);
      ctx.stroke();
      // Rivets
      ctx.fillStyle = '#d5dbe6';
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        ctx.fillRect(x + Math.cos(a) * r * 0.5 - 0.75, y + Math.sin(a) * r * 0.5 - 0.75, 1.5, 1.5);
      }
      break;
    case 'glass': {
      halo(ctx, x, y, r, 'rgba(140,225,255,1)', 0.22);
      ctx.fillStyle = 'rgba(140,220,255,0.25)';
      ctx.strokeStyle = 'rgba(200,245,255,0.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      // One crack per hit taken.
      const cracks = Math.max(0, KINDS.glass.hp - b.hp);
      ctx.beginPath();
      for (let i = 0; i < cracks; i++) {
        const a = i * 2.4;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case 'splitter':
      halo(ctx, x, y, r, 'rgba(255,150,70,1)', 0.22);
      shadedDisc(ctx, x, y, r, '#ffd2a0', '#d9632b');
      ctx.strokeStyle = 'rgba(70,25,0,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x, y + r);
      ctx.stroke();
      break;
    case 'phantom': {
      const pulse = 0.45 + 0.2 * Math.sin(time * 5);
      halo(ctx, x, y, r, 'rgba(190,140,255,1)', pulse);
      ctx.fillStyle = `rgba(190,140,255,${pulse})`;
      ctx.beginPath();
      ctx.arc(x, y, r + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(240,225,255,0.95)';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'shard':
      ctx.fillStyle = `rgba(200,245,255,${Math.min(1, b.life / 0.3)})`;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      ctx.fill();
      break;
  }
}

/** A power-up token: tinted disc with a simple vector glyph. */
export function drawPowerIcon(ctx: CanvasRenderingContext2D, kind: PowerKind, x: number, y: number, time: number, scale = 1): void {
  const color = POWER_COLORS[kind];
  const r = 10;
  const pulse = 1 + 0.08 * Math.sin(time * 6);

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.5 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#121a2c';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  switch (kind) {
    case 'magnet':
      ctx.arc(0, 0, 4.5, 0, Math.PI);
      ctx.moveTo(-4.5, 0);
      ctx.lineTo(-4.5, -4.5);
      ctx.moveTo(4.5, 0);
      ctx.lineTo(4.5, -4.5);
      ctx.stroke();
      break;
    case 'bomb':
      ctx.arc(-1, 1.5, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(1.5, -1.5);
      ctx.quadraticCurveTo(3, -5, 5.5, -5);
      ctx.stroke();
      break;
    case 'multiplier':
      ctx.font = '800 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('×2', 0, 0.5);
      break;
    case 'fast':
      for (const dx of [-3, 2]) {
        ctx.moveTo(dx - 2, -4);
        ctx.lineTo(dx + 2, 0);
        ctx.lineTo(dx - 2, 4);
      }
      ctx.stroke();
      break;
    case 'freeze':
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        ctx.moveTo(Math.cos(a) * 5.5, Math.sin(a) * 5.5);
        ctx.lineTo(-Math.cos(a) * 5.5, -Math.sin(a) * 5.5);
      }
      ctx.stroke();
      break;
  }
  ctx.restore();
}
