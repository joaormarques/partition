import type { AudioEngine } from '../audio/AudioEngine';
import { DIFFICULTIES, type Difficulty, DIFFICULTY_ORDER, isDifficulty } from '../game/difficulty';
import type { Game } from '../game/Game';
import type { ScoreTable } from '../storage';

export interface SettingsDeps {
  game: Game;
  audio: AudioEngine;
  scores: () => ScoreTable;
  onDifficulty: (d: Difficulty) => void;
  onResetScores: () => void;
  onAudioChange: () => void;
}

export interface SettingsDialog {
  open: () => void;
  readonly isOpen: boolean;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export function setupSettings(deps: SettingsDeps): SettingsDialog {
  const dialog = $<HTMLDialogElement>('#settings');
  const options = $('#difficulty-options');
  const note = $('#difficulty-note');
  const sound = $<HTMLInputElement>('#opt-sound');
  const music = $<HTMLInputElement>('#opt-music');
  const scoresList = $('#scores');
  const reset = $<HTMLButtonElement>('#reset-scores');

  for (const d of DIFFICULTY_ORDER) {
    const spec = DIFFICULTIES[d];
    const label = document.createElement('label');
    label.className = 'option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'difficulty';
    input.value = d;
    const body = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = spec.label;
    const blurb = document.createElement('small');
    blurb.textContent = spec.blurb;
    body.append(name, blurb);
    label.append(input, body);
    options.append(label);
  }

  const inGame = () => deps.game.phase !== 'title' && deps.game.phase !== 'gameOver';

  function renderScores(): void {
    const d = deps.game.difficulty;
    $('#scores-title').textContent = `Best scores · ${DIFFICULTIES[d].label}`;
    const list = deps.scores()[d];
    scoresList.replaceChildren();
    if (list.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No scores yet.';
      scoresList.append(li);
    }
    for (const e of list) {
      const li = document.createElement('li');
      const date = new Date(e.date);
      const when = Number.isNaN(date.getTime()) ? '' : ` · ${date.toLocaleDateString()}`;
      li.append(`${e.score.toLocaleString('en-US')} `);
      const meta = document.createElement('span');
      meta.textContent = `level ${e.level}${when}`;
      li.append(meta);
      scoresList.append(li);
    }
    reset.hidden = list.length === 0;
  }

  function refresh(): void {
    for (const input of options.querySelectorAll<HTMLInputElement>('input')) {
      input.checked = input.value === deps.game.difficulty;
    }
    note.hidden = !(inGame() && deps.game.difficulty !== deps.game.activeDifficulty);
    sound.checked = !deps.audio.muted;
    music.checked = deps.audio.musicOn;
    music.disabled = deps.audio.muted;
    reset.classList.remove('armed');
    reset.textContent = 'Reset';
    renderScores();
  }

  options.addEventListener('change', (e) => {
    const value = (e.target as HTMLInputElement).value;
    if (!isDifficulty(value)) return;
    deps.onDifficulty(value);
    refresh();
  });

  sound.addEventListener('change', () => {
    if (sound.checked === deps.audio.muted) deps.audio.toggleMute();
    deps.onAudioChange();
    refresh();
  });
  music.addEventListener('change', () => {
    if (music.checked !== deps.audio.musicOn) deps.audio.toggleMusic();
    deps.onAudioChange();
    refresh();
  });

  // Two-step reset instead of a blocking confirm().
  reset.addEventListener('click', () => {
    if (!reset.classList.contains('armed')) {
      reset.classList.add('armed');
      reset.textContent = 'Click again to reset';
      return;
    }
    deps.onResetScores();
    refresh();
  });

  return {
    open() {
      if (deps.game.phase === 'playing') deps.game.togglePause();
      refresh();
      dialog.showModal();
    },
    get isOpen() {
      return dialog.open;
    },
  };
}
