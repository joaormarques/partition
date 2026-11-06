import type { BallKind } from '../game/Ball';
import { WIDTH } from '../game/constants';
import type { Game, GameEvent, Phase } from '../game/Game';
import type { PowerKind } from '../game/PowerUps';
import { LOOP_STEPS, midiToFreq, musicStep, type Note, STEP_SECONDS } from './music';

/** Everything is synthesized with Web Audio: no sample files. */

interface ToneOptions {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  /** Glide to this frequency over the note. */
  to?: number;
  pan?: number;
  when?: number;
  /** Optional low-pass cutoff. */
  cutoff?: number;
  detune?: number;
  bus?: AudioNode;
}

interface NoiseOptions {
  gain?: number;
  filter?: BiquadFilterType;
  freq?: number;
  to?: number;
  q?: number;
  pan?: number;
  when?: number;
  bus?: AudioNode;
}

interface Settings {
  muted: boolean;
  music: boolean;
}

const SETTINGS_KEY = 'partition.audio';
const LOOKAHEAD = 0.12; // s of music scheduled ahead
const SCHEDULE_EVERY = 25; // ms
const BOUNCE_GAP = 0.07; // s between bounce sounds

const PENTATONIC = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81];
const COLLECT_ROOT: Record<PowerKind, number> = { magnet: 64, bomb: 57, multiplier: 69, fast: 67, freeze: 76 };

const MUSIC_LEVEL: Record<Phase, number> = {
  title: 0.5,
  playing: 0.6,
  paused: 0.22,
  levelComplete: 0,
  gameOver: 0,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      return { muted: !!s.muted, music: s.music !== false };
    }
  } catch {
    // Storage blocked or corrupt: fall back to defaults.
  }
  return { muted: false, music: true };
}

function panFor(x: number): number {
  return Math.max(-0.7, Math.min(0.7, (x / WIDTH) * 1.4 - 0.7));
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicGain!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;

  private settings = loadSettings();
  private lastBounce = 0;
  private hum: { oscs: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private musicTimer: number | null = null;
  private nextStepTime = 0;
  private step = 0;
  private intensity: 0 | 1 | 2 = 0;
  private phase: Phase = 'title';

  get muted(): boolean {
    return this.settings.muted;
  }

  get musicOn(): boolean {
    return this.settings.music;
  }

  /** Must be called from a user gesture: browsers only allow audio after one. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.build();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.startMusic();
  }

  toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    this.save();
    this.applyLevels();
  }

  toggleMusic(): void {
    this.settings.music = !this.settings.music;
    this.save();
    this.applyLevels();
  }

  /** Pause all audio while the tab is hidden. */
  setHidden(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /** Per frame: music layers and ducking follow the game phase; the hum follows growing walls. */
  update(game: Game): void {
    if (!this.ctx) return;
    this.intensity = game.phase === 'title' ? 0 : game.level >= 3 ? 2 : 1;
    if (game.phase !== this.phase) {
      this.phase = game.phase;
      this.applyLevels();
    }
    this.updateHum(game);
  }

  handle(events: readonly GameEvent[]): void {
    if (!this.ctx || this.settings.muted) return;
    for (const e of events) {
      switch (e.type) {
        case 'bounce':
          this.bounce(e.kind, e.x);
          break;
        case 'wallStart':
          this.tone(300, 0.09, { type: 'triangle', to: 620, gain: 0.07, pan: panFor(e.x) });
          break;
        case 'wallDone':
          this.wallDone(e.cells, e.rect.x + e.rect.w / 2);
          break;
        case 'wallBreak':
          this.wallBreak(e.x);
          break;
        case 'shatter':
          this.shatter(e.x);
          break;
        case 'split':
          this.tone(440, 0.07, { type: 'square', gain: 0.05, cutoff: 1800, pan: panFor(e.x) });
          this.tone(660, 0.07, { type: 'square', gain: 0.05, cutoff: 1800, pan: panFor(e.x), when: 0.06 });
          break;
        case 'bomb':
          this.bomb(e.x);
          break;
        case 'collect':
          this.collect(e.kind, e.x);
          break;
        case 'levelClear':
          this.fanfare([69, 72, 76, 81], 0.09, 'triangle');
          break;
        case 'gameOver':
          this.fanfare([64, 60, 57, 52], 0.22, 'sawtooth');
          break;
      }
    }
  }

  /** Small UI tick (rotate, toggles). */
  click(): void {
    if (!this.ctx || this.settings.muted) return;
    this.tone(1300, 0.025, { type: 'square', gain: 0.025, cutoff: 3000 });
  }

  // ── Graph ─────────────────────────────────────────────────────────────────

  private build(): void {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);

    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.musicFilter).connect(this.master);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.applyLevels();
  }

  private applyLevels(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 0.8, now, 0.03);
    const music = this.settings.music ? MUSIC_LEVEL[this.phase] : 0;
    this.musicGain.gain.setTargetAtTime(music * 0.5, now, this.phase === 'paused' ? 0.15 : 0.4);
    this.musicFilter.frequency.setTargetAtTime(this.phase === 'paused' ? 700 : 18000, now, 0.2);
  }

  private save(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Not persisted; the toggle still works for this session.
    }
  }

  // ── Primitives ────────────────────────────────────────────────────────────

  private out(pan: number | undefined, bus: AudioNode | undefined): AudioNode {
    const ctx = this.ctx!;
    const dest = bus ?? this.sfx;
    if (!pan) return dest;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(dest);
    return p;
  }

  private tone(freq: number, dur: number, o: ToneOptions = {}): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.when ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const peak = o.gain ?? 0.1;
    const attack = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (o.cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.cutoff;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(this.out(o.pan, o.bus));
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, o: NoiseOptions = {}): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.when ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? 'lowpass';
    f.frequency.setValueAtTime(o.freq ?? 2000, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain ?? 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out(o.pan, o.bus));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ── Sound effects ─────────────────────────────────────────────────────────

  private bounce(kind: BallKind, x: number): void {
    const now = this.ctx!.currentTime;
    if (kind === 'shard' || now - this.lastBounce < BOUNCE_GAP) return;
    this.lastBounce = now;
    const pan = panFor(x);
    switch (kind) {
      case 'basic':
        this.tone(520 + Math.random() * 140, 0.06, { gain: 0.045, pan });
        break;
      case 'heavy':
        this.tone(150, 0.12, { to: 80, gain: 0.12, pan });
        break;
      case 'glass':
        this.tone(1900 + Math.random() * 400, 0.08, { type: 'triangle', gain: 0.04, pan });
        this.tone(2850, 0.05, { type: 'sine', gain: 0.025, pan });
        break;
      case 'splitter':
        this.tone(330, 0.07, { type: 'square', gain: 0.035, cutoff: 1400, pan });
        break;
      case 'phantom':
        this.tone(260, 0.12, { type: 'sine', gain: 0.03, attack: 0.03, pan });
        break;
    }
  }

  private wallDone(cells: number, x: number): void {
    const pan = panFor(x);
    this.tone(170, 0.18, { to: 60, gain: 0.22, pan });
    this.noiseBurst(0.08, { gain: 0.08, filter: 'lowpass', freq: 1200, pan });
    // A rising arpeggio; bigger captures play more notes.
    const count = 2 + Math.min(5, Math.floor(cells / 120));
    const start = Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const midi = PENTATONIC[Math.min(PENTATONIC.length - 1, start + i * 2)];
      this.tone(midiToFreq(midi + 12), 0.22, { type: 'triangle', gain: 0.06, when: 0.03 + i * 0.045, pan });
    }
  }

  private wallBreak(x: number): void {
    const pan = panFor(x);
    this.noiseBurst(0.25, { gain: 0.25, filter: 'bandpass', freq: 1400, to: 400, q: 1.5, pan });
    this.tone(240, 0.38, { type: 'sawtooth', to: 60, gain: 0.1, cutoff: 1500, pan });
  }

  private shatter(x: number): void {
    const pan = panFor(x);
    this.noiseBurst(0.3, { gain: 0.12, filter: 'highpass', freq: 4000, pan });
    for (let i = 0; i < 4; i++) {
      this.tone(2000 + Math.random() * 2200, 0.12, { type: 'triangle', gain: 0.035, when: i * 0.035, pan });
    }
  }

  private bomb(x: number): void {
    const pan = panFor(x) * 0.5;
    this.noiseBurst(0.9, { gain: 0.45, filter: 'lowpass', freq: 1000, to: 90, pan });
    this.tone(95, 0.8, { to: 32, gain: 0.45, pan });
  }

  private collect(kind: PowerKind, x: number): void {
    const root = COLLECT_ROOT[kind];
    [0, 4, 7, 12].forEach((step, i) => {
      this.tone(midiToFreq(root + step), 0.12, { type: 'square', gain: 0.045, cutoff: 2600, when: i * 0.055, pan: panFor(x) });
    });
  }

  private fanfare(notes: number[], gap: number, type: OscillatorType): void {
    notes.forEach((m, i) => {
      this.tone(midiToFreq(m), 0.5, { type, gain: 0.08, cutoff: 2400, when: i * gap });
    });
    const last = notes.length * gap;
    for (const m of notes.slice(0, 3)) {
      this.tone(midiToFreq(m - 12), 1.1, { type: 'sawtooth', gain: 0.03, cutoff: 900, attack: 0.08, when: last });
    }
  }

  // ── Wall hum ──────────────────────────────────────────────────────────────

  private updateHum(game: Game): void {
    const ctx = this.ctx!;
    const growing = game.phase === 'playing' && game.halves.some((h) => h.state === 'growing');
    if (growing && !this.hum && !this.settings.muted) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      const oscs = [ctx.createOscillator(), ctx.createOscillator()];
      oscs[0].type = 'sawtooth';
      oscs[1].type = 'sine';
      for (const o of oscs) {
        o.connect(filter);
        o.start();
      }
      filter.connect(gain).connect(this.sfx);
      gain.gain.setTargetAtTime(0.035, ctx.currentTime, 0.03);
      this.hum = { oscs, gain, filter };
    }
    if (this.hum) {
      if (!growing || this.settings.muted) {
        const { oscs, gain } = this.hum;
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
        for (const o of oscs) o.stop(ctx.currentTime + 0.2);
        this.hum = null;
        return;
      }
      // Pitch rises as the wall gets longer.
      const progress = Math.max(0, ...game.halves.map((h) => h.progress));
      const f = 110 * 2 ** Math.min(1, progress / 24);
      this.hum.oscs[0].frequency.setTargetAtTime(f, ctx.currentTime, 0.05);
      this.hum.oscs[1].frequency.setTargetAtTime(f * 2, ctx.currentTime, 0.05);
      this.hum.filter.frequency.setTargetAtTime(500 + f * 3, ctx.currentTime, 0.05);
    }
  }

  // ── Music ─────────────────────────────────────────────────────────────────

  private startMusic(): void {
    if (this.musicTimer !== null || !this.ctx) return;
    this.nextStepTime = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), SCHEDULE_EVERY);
  }

  private scheduleMusic(): void {
    const ctx = this.ctx!;
    if (ctx.state !== 'running') {
      this.nextStepTime = ctx.currentTime + 0.1;
      return;
    }
    // Don't spend nodes on music nobody can hear.
    const silent = this.settings.muted || !this.settings.music || MUSIC_LEVEL[this.phase] === 0;
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD) {
      if (!silent) {
        for (const n of musicStep(this.step, this.intensity)) this.playNote(n, this.nextStepTime - ctx.currentTime);
      }
      this.nextStepTime += STEP_SECONDS;
      this.step = (this.step + 1) % LOOP_STEPS;
    }
  }

  private playNote(n: Note, when: number): void {
    const bus = this.musicGain;
    const dur = n.steps * STEP_SECONDS;
    const f = midiToFreq(n.midi);
    switch (n.voice) {
      case 'bass':
        this.tone(f, dur * 0.95, { type: 'sawtooth', gain: 0.16 * n.velocity, cutoff: 520, when, bus });
        break;
      case 'arp':
        this.tone(f, 0.16, { type: 'square', gain: 0.05 * n.velocity, cutoff: 2200, when, bus, pan: n.midi % 2 ? 0.3 : -0.3 });
        break;
      case 'pad':
        this.tone(f, dur, { type: 'sawtooth', gain: 0.025, cutoff: 900, attack: 0.35, detune: -7, when, bus });
        this.tone(f, dur, { type: 'sawtooth', gain: 0.025, cutoff: 900, attack: 0.35, detune: 7, when, bus });
        break;
      case 'kick':
        this.tone(150, 0.14, { to: 45, gain: 0.4 * n.velocity, when, bus });
        break;
      case 'hat':
        this.noiseBurst(0.04, { gain: 0.05 * n.velocity, filter: 'highpass', freq: 7000, when, bus });
        break;
    }
  }
}
