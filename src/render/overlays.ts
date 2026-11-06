import { Ball, type BallKind } from '../game/Ball';
import { HEIGHT, WIDTH } from '../game/constants';
import type { Game } from '../game/Game';
import { DIFFICULTIES } from '../game/difficulty';
import type { PowerKind } from '../game/PowerUps';
import { drawBall, drawPowerIcon } from './sprites';
import { FONT, T } from './theme';

const BALL_LEGEND: Array<[BallKind, string, string]> = [
  ['basic', 'Basic', 'Steady bouncer'],
  ['heavy', 'Heavy', 'Falls with gravity'],
  ['glass', 'Glass', 'Shatters after 6 bounces'],
  ['splitter', 'Splitter', 'Splits when it breaks a wall'],
  ['phantom', 'Phantom', 'Drifts through filled areas'],
];

const POWER_LEGEND: Array<[PowerKind, string, string]> = [
  ['magnet', 'Magnet', 'Next wall repels balls'],
  ['bomb', 'Bomb', 'Next click detonates'],
  ['multiplier', 'Multiplier', '×2, then ×3 points'],
  ['fast', 'Fast walls', 'Walls grow twice as fast'],
  ['freeze', 'Freeze', 'Balls stop for 2 seconds'],
];

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = T.panel;
  ctx.strokeStyle = T.panelEdge;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.stroke();
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = 400,
  align: CanvasTextAlign = 'center',
): void {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

function glowTitle(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number): void {
  ctx.save();
  ctx.shadowColor = T.edge;
  ctx.shadowBlur = 22;
  text(ctx, s, x, y, size, T.text, 800);
  ctx.restore();
}

function prompt(ctx: CanvasRenderingContext2D, s: string, y: number, time: number): void {
  const a = 0.65 + 0.35 * Math.sin(time * 3.2);
  ctx.save();
  ctx.globalAlpha = a;
  text(ctx, s, WIDTH / 2, y, 16, T.accent, 600);
  ctx.restore();
}

const fmt = (n: number) => n.toLocaleString('en-US');

/** Things the overlays show that live outside the game itself. */
export interface OverlayInfo {
  /** Best score for the difficulty shown. */
  best: number;
  /** The game that just ended set a new best. */
  newBest: boolean;
  /** Last input was touch: say "Tap" rather than "Click". */
  touch: boolean;
}

/** Full-screen overlays for every phase except active play. `clock` is real time, for pulsing. */
export function drawOverlay(ctx: CanvasRenderingContext2D, game: Game, clock: number, info: OverlayInfo): void {
  if (game.phase === 'playing') return;
  ctx.fillStyle = T.scrim;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const verb = info.touch ? 'Tap' : 'Click';

  switch (game.phase) {
    case 'title':
      drawTitle(ctx, game, clock, info);
      break;
    case 'paused': {
      panel(ctx, WIDTH / 2 - 150, HEIGHT / 2 - 60, 300, 120);
      text(ctx, 'Paused', WIDTH / 2, HEIGHT / 2 - 16, 30, T.text, 800);
      text(ctx, info.touch ? 'Tap to resume' : 'Click, P or Esc to resume', WIDTH / 2, HEIGHT / 2 + 24, 15, T.textDim);
      break;
    }
    case 'levelComplete': {
      const r = game.result;
      const rows: Array<[string, string]> = [
        ['Filled', `${Math.floor(game.fillRatio() * 100)}%`],
        ['Lives bonus', `+${fmt(r?.livesBonus ?? 0)}`],
        ['Fill bonus', `+${fmt(r?.fillBonus ?? 0)}`],
      ];
      scorePanel(ctx, `Level ${game.level} cleared`, rows, game.score, `${verb} for level ${game.level + 1}`, clock);
      break;
    }
    case 'gameOver': {
      const rows: Array<[string, string]> = [
        ['Reached level', String(game.level)],
        ['Difficulty', DIFFICULTIES[game.activeDifficulty].label],
        ['Best', fmt(info.best)],
      ];
      const badge = info.newBest ? 'New best score!' : undefined;
      scorePanel(ctx, 'Game over', rows, game.score, `${verb} to play again`, clock, badge);
      break;
    }
  }
}

function scorePanel(
  ctx: CanvasRenderingContext2D,
  title: string,
  rows: Array<[string, string]>,
  score: number,
  cta: string,
  clock: number,
  badge?: string,
): void {
  const w = 380;
  const extra = badge ? 26 : 0;
  const h = 150 + rows.length * 30 + extra;
  const x = WIDTH / 2 - w / 2;
  const y = HEIGHT / 2 - h / 2;
  panel(ctx, x, y, w, h);
  glowTitle(ctx, title, WIDTH / 2, y + 40, 30);
  if (badge) text(ctx, badge, WIDTH / 2, y + 72, 15, T.accent, 700);
  let ry = y + 86 + extra;
  for (const [label, value] of rows) {
    text(ctx, label, x + 40, ry, 15, T.textDim, 400, 'left');
    text(ctx, value, x + w - 40, ry, 15, T.text, 600, 'right');
    ry += 30;
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.moveTo(x + 40, ry - 12);
  ctx.lineTo(x + w - 40, ry - 12);
  ctx.stroke();
  text(ctx, 'Score', x + 40, ry + 6, 17, T.text, 700, 'left');
  text(ctx, fmt(score), x + w - 40, ry + 6, 20, T.accent, 800, 'right');
  prompt(ctx, cta, y + h + 28, clock);
}

function drawTitle(ctx: CanvasRenderingContext2D, game: Game, clock: number, info: OverlayInfo): void {
  const diff = DIFFICULTIES[game.difficulty];
  glowTitle(ctx, 'PARTITION', WIDTH / 2, 78, 60);
  text(ctx, 'Divide the board. Seal the circuit.', WIDTH / 2, 122, 17, T.textDim);
  text(
    ctx,
    `Fill ${Math.round(diff.winFill * 100)}% without letting a ball touch a growing wall. Seal power-ups in to collect them.`,
    WIDTH / 2,
    150,
    13,
    T.textDim,
  );

  const px = 48;
  const py = 176;
  const pw = WIDTH - px * 2;
  panel(ctx, px, py, pw, 236);
  const colW = pw / 2;
  text(ctx, 'BALLS', px + 32, py + 26, 12, T.edge, 700, 'left');
  text(ctx, 'POWER-UPS', px + colW + 16, py + 26, 12, T.edge, 700, 'left');

  BALL_LEGEND.forEach(([kind, label, desc], i) => {
    const y = py + 62 + i * 36;
    const b = new Ball(px + 44, y, 0, 0, kind);
    drawBall(ctx, b, clock);
    text(ctx, label, px + 66, y, 14, T.text, 600, 'left');
    text(ctx, desc, px + 150, y, 13, T.textDim, 400, 'left');
  });
  POWER_LEGEND.forEach(([kind, label, desc], i) => {
    const y = py + 62 + i * 36;
    drawPowerIcon(ctx, kind, px + colW + 28, y, clock, 0.9);
    text(ctx, label, px + colW + 50, y, 14, T.text, 600, 'left');
    text(ctx, desc, px + colW + 128, y, 13, T.textDim, 400, 'left');
  });

  const best = info.best > 0 ? `   ·   Best ${fmt(info.best)}` : '';
  text(ctx, `${diff.label}${best}   ·   change in Settings`, WIDTH / 2, 434, 13, T.text, 600);
  text(
    ctx,
    info.touch
      ? 'Tap: build wall   ·   Swipe: build wall in that direction   ·   ↕ button: rotate'
      : 'Click: build wall   ·   Right-click / Space: rotate   ·   P: pause   ·   M: mute',
    WIDTH / 2,
    456,
    12,
    T.textDim,
  );
  prompt(ctx, `${info.touch ? 'Tap' : 'Click'} to start`, 486, clock);
}

/** Level banner shown for the first seconds of a level. */
export function drawIntro(ctx: CanvasRenderingContext2D, game: Game): void {
  if (!game.intro || game.phase !== 'playing') return;
  const t = game.time - game.intro.at;
  const total = game.intro.subtitle ? 3 : 1.6;
  if (t < 0 || t >= total) return;
  const alpha = Math.min(1, t / 0.2, (total - t) / 0.5);
  const h = game.intro.subtitle ? 78 : 54;
  const y = HEIGHT / 2 - h / 2;

  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createLinearGradient(0, 0, WIDTH, 0);
  g.addColorStop(0, 'rgba(6,10,20,0)');
  g.addColorStop(0.2, 'rgba(6,10,20,0.88)');
  g.addColorStop(0.8, 'rgba(6,10,20,0.88)');
  g.addColorStop(1, 'rgba(6,10,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, y, WIDTH, h);
  ctx.fillStyle = T.edge;
  ctx.globalAlpha = alpha * 0.6;
  ctx.fillRect(WIDTH * 0.2, y, WIDTH * 0.6, 1);
  ctx.fillRect(WIDTH * 0.2, y + h - 1, WIDTH * 0.6, 1);
  ctx.globalAlpha = alpha;
  glowTitle(ctx, game.intro.title, WIDTH / 2, y + (game.intro.subtitle ? 26 : h / 2), 26);
  if (game.intro.subtitle) text(ctx, game.intro.subtitle, WIDTH / 2, y + 56, 15, T.accent, 500);
  ctx.restore();
}
