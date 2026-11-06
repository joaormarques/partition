import './style.css';
import { AudioEngine } from './audio/AudioEngine';
import { CELL, HEIGHT, TICK, WIDTH } from './game/constants';
import { DIFFICULTIES } from './game/difficulty';
import { Game } from './game/Game';
import { FAST_TIME, FREEZE_TIME, MULTIPLIER_TIME } from './game/PowerUps';
import type { GameEvent } from './game/Game';
import { Renderer } from './render/Renderer';
import { POWER_COLORS } from './render/theme';
import { emptyTable, insertScore, loadScores, loadSettings, saveScores, saveSettings } from './storage';
import { setupSettings } from './ui/settingsDialog';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>('#field');
const hud = {
  level: $('#hud-level'),
  lives: $('#hud-lives'),
  balls: $('#hud-balls'),
  fill: $('#hud-fill'),
  fillBar: $('#hud-fill-bar'),
  score: $('#hud-score'),
  orient: $<HTMLButtonElement>('#hud-orient'),
  sound: $<HTMLButtonElement>('#hud-sound'),
  music: $<HTMLButtonElement>('#hud-music'),
  settings: $<HTMLButtonElement>('#hud-settings'),
  target: $('#hud-target'),
  targetMark: $('#hud-target-mark'),
  effects: $('#effects'),
};

const game = new Game();
const renderer = new Renderer(canvas);
const audio = new AudioEngine();
// Handy for poking at state from the console during development.
if (import.meta.env.DEV) Object.assign(window, { game, audio });
let hover: [number, number] | null = null;

// ── Saved settings and scores ───────────────────────────────────────────────

let scores = loadScores();
game.difficulty = loadSettings().difficulty;
let newBest = false;
/** Last input was a touch, so prompts say "Tap". */
let touchMode = false;

function recordGameOver(): void {
  const d = game.activeDifficulty;
  const { list, rank } = insertScore(scores[d], { score: game.score, level: game.level, date: new Date().toISOString() });
  scores = { ...scores, [d]: list };
  saveScores(scores);
  newBest = rank === 0;
}

function bestScore(): number {
  const d = game.phase === 'title' ? game.difficulty : game.activeDifficulty;
  return scores[d][0]?.score ?? 0;
}

const settings = setupSettings({
  game,
  audio,
  scores: () => scores,
  onDifficulty: (d) => {
    game.difficulty = d;
    saveSettings({ difficulty: d });
  },
  onResetScores: () => {
    scores = emptyTable();
    saveScores(scores);
  },
  onAudioChange: () => syncAudioButtons(),
});
hud.settings.addEventListener('click', () => settings.open());

// ?level=N starts the game on level N, for playtesting later ball kinds (dev builds only).
const startLevel = import.meta.env.DEV
  ? Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get('level'))) || 1)
  : 1;

function cellFromEvent(e: PointerEvent): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
  const y = ((e.clientY - rect.top) / rect.height) * HEIGHT;
  return [Math.floor(x / CELL), Math.floor(y / CELL)];
}

function advance(): void {
  if (game.phase === 'title' || game.phase === 'gameOver') {
    newBest = false;
    game.startNewGame(startLevel);
  }
  else if (game.phase === 'levelComplete') game.nextLevel();
}

function rotate(): void {
  game.toggleOrientation();
  audio.click();
}

function syncAudioButtons(): void {
  hud.sound.setAttribute('aria-pressed', String(!audio.muted));
  hud.music.setAttribute('aria-pressed', String(audio.musicOn));
}

// Browsers only allow audio to start from a user gesture.
window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
window.addEventListener('keydown', () => audio.unlock(), { capture: true });
document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden));

hud.sound.addEventListener('click', () => {
  audio.toggleMute();
  audio.click();
  syncAudioButtons();
  hud.sound.blur();
});
hud.music.addEventListener('click', () => {
  audio.toggleMusic();
  audio.click();
  syncAudioButtons();
  hud.music.blur();
});
syncAudioButtons();

// ── Pointer input ───────────────────────────────────────────────────────────
// Mouse: click builds immediately. Touch: the wall is built on release, at the
// cell first touched; a swipe sets its direction (sideways = horizontal).

const SWIPE_PX = 18;
let touch: { id: number; x: number; y: number; cell: [number, number] } | null = null;

canvas.addEventListener('pointermove', (e) => {
  if (touch && e.pointerId === touch.id) {
    const dx = e.clientX - touch.x;
    const dy = e.clientY - touch.y;
    if (Math.hypot(dx, dy) > SWIPE_PX) {
      const o = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (game.orientation !== o) {
        game.orientation = o;
        audio.click();
      }
    }
    return;
  }
  if (e.pointerType !== 'touch') hover = cellFromEvent(e);
});
canvas.addEventListener('pointerleave', () => {
  if (!touch) hover = null;
});
canvas.addEventListener('pointerup', (e) => {
  if (!touch || e.pointerId !== touch.id) return;
  game.click(...touch.cell);
  touch = null;
  hover = null;
});
canvas.addEventListener('pointercancel', () => {
  touch = null;
  hover = null;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  touchMode = e.pointerType === 'touch';
  if (e.button === 2) {
    rotate();
    return;
  }
  if (e.button !== 0) return;
  if (game.phase === 'playing' && touchMode) {
    touch = { id: e.pointerId, x: e.clientX, y: e.clientY, cell: cellFromEvent(e) };
    hover = touch.cell;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Not capturable (e.g. a synthetic event); moves over the canvas still work.
    }
    return;
  }
  if (game.phase === 'playing') game.click(...cellFromEvent(e));
  else if (game.phase === 'paused') game.togglePause();
  else advance();
});

hud.orient.addEventListener('click', () => {
  rotate();
  hud.orient.blur();
});

window.addEventListener('keydown', (e) => {
  if (settings.isOpen) return; // the dialog handles its own keys (Esc closes it)
  touchMode = false;
  if (e.code === 'Space') {
    e.preventDefault();
    rotate();
  } else if (e.code === 'KeyM') {
    audio.toggleMute();
    syncAudioButtons();
  } else if (e.code === 'KeyP' || e.code === 'Escape') {
    game.togglePause();
  } else if (e.code === 'Enter') {
    advance();
  }
});
window.addEventListener('blur', () => {
  if (game.phase === 'playing') game.togglePause();
});
window.addEventListener('resize', () => renderer.resize());

// ── HUD ─────────────────────────────────────────────────────────────────────

let shownScore = 0;
let shownLives = -1;

function updateHud(dt: number): void {
  hud.level.textContent = String(game.level);
  hud.balls.textContent = String(game.balls.filter((b) => b.kind !== 'shard').length);

  const lives = Math.max(0, game.lives);
  if (lives !== shownLives) {
    hud.lives.innerHTML = lives > 8 ? `<span class="pip"></span>×${lives}` : '<span class="pip"></span>'.repeat(lives);
    hud.lives.setAttribute('aria-label', `${lives} lives`);
    hud.lives.classList.toggle('hit', lives < shownLives);
    shownLives = lives;
  }

  const pct = Math.floor(game.fillRatio() * 100);
  hud.fill.textContent = `${pct}%`;
  hud.fillBar.style.width = `${pct}%`;
  const target = Math.round((game.phase === 'title' ? DIFFICULTIES[game.difficulty].winFill : game.winFill) * 100);
  hud.target.textContent = `/ ${target}%`;
  hud.targetMark.style.left = `${target}%`;
  hud.fillBar.parentElement!.classList.toggle('done', pct >= target);
  hud.fillBar.parentElement!.setAttribute('aria-valuenow', String(pct));

  // Count the score up rather than jumping.
  shownScore += (game.score - shownScore) * Math.min(1, dt * 8);
  if (Math.abs(game.score - shownScore) < 1 || game.score < shownScore) shownScore = game.score;
  hud.score.textContent = Math.round(shownScore).toLocaleString('en-US');

  hud.orient.textContent = game.orientation === 'h' ? '↔' : '↕';
  renderChips();
}

interface Chip {
  key: string;
  color: string;
  label: string;
  hint: string;
  /** Remaining fraction for timed effects. */
  frac: number | null;
}

let chipSignature = '';

function activeChips(): Chip[] {
  if (game.phase !== 'playing' && game.phase !== 'paused') return [];
  const left = (until: number, total: number) => Math.max(0, Math.min(1, (until - game.time) / total));
  const chips: Chip[] = [];
  if (game.bombs > 0)
    chips.push({ key: 'bomb', color: POWER_COLORS.bomb, label: `Bomb ×${game.bombs}`, hint: 'next click detonates', frac: null });
  if (game.magnets > 0)
    chips.push({ key: 'magnet', color: POWER_COLORS.magnet, label: `Magnet ×${game.magnets}`, hint: 'next wall repels', frac: null });
  if (game.multiplier > 1)
    chips.push({
      key: 'mult',
      color: POWER_COLORS.multiplier,
      label: `Score ×${game.multiplier}`,
      hint: '',
      frac: left(game.multiplierUntil, MULTIPLIER_TIME),
    });
  if (game.fastWalls)
    chips.push({ key: 'fast', color: POWER_COLORS.fast, label: 'Fast walls', hint: '', frac: left(game.fastUntil, FAST_TIME) });
  if (game.frozen)
    chips.push({ key: 'freeze', color: POWER_COLORS.freeze, label: 'Frozen', hint: '', frac: left(game.freezeUntil, FREEZE_TIME) });
  return chips;
}

function renderChips(): void {
  const chips = activeChips();
  const signature = chips.map((c) => c.key + c.label).join('|');
  if (signature !== chipSignature) {
    // Static strings only, so innerHTML is safe here.
    hud.effects.innerHTML = chips
      .map(
        (c) =>
          `<div class="chip" style="--c:${c.color}"><span class="dot"></span><b>${c.label}</b>` +
          `${c.hint ? `<span class="hint">${c.hint}</span>` : ''}${c.frac !== null ? '<span class="time"></span>' : ''}</div>`,
      )
      .join('');
    chipSignature = signature;
  }
  chips.forEach((c, i) => {
    if (c.frac === null) return;
    const bar = hud.effects.children[i]?.querySelector<HTMLElement>('.time');
    if (bar) bar.style.width = `${c.frac * 100}%`;
  });
}

// ── Loop ────────────────────────────────────────────────────────────────────

let last = performance.now();
let acc = 0;
function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= TICK) {
    game.update(TICK);
    acc -= TICK;
  }
  const events: GameEvent[] = game.events.splice(0);
  if (events.some((e) => e.type === 'gameOver')) recordGameOver();
  renderer.handle(events);
  audio.handle(events);
  audio.update(game);
  renderer.draw(game, hover, dt, { best: bestScore(), newBest, touch: touchMode });
  updateHud(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
