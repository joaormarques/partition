/**
 * An original looping track, generated step by step. Pure data, no Web Audio,
 * so the arrangement can be unit-tested.
 *
 * 4 bars of 16 sixteenth-note steps over i–VI–III–VII in A minor. Intensity
 * adds layers: 0 = pads and a sparse arpeggio (menus), 1 = bass, kick and
 * hats, 2 = four-on-the-floor kick, 16th hats and a denser arpeggio.
 */

export const BPM = 108;
export const STEPS_PER_BAR = 16;
export const BARS = 4;
export const LOOP_STEPS = STEPS_PER_BAR * BARS;
export const STEP_SECONDS = 60 / BPM / 4;

export type Voice = 'bass' | 'arp' | 'pad' | 'kick' | 'hat';

export interface Note {
  voice: Voice;
  /** MIDI note number; unused for drums. */
  midi: number;
  /** Length in steps. */
  steps: number;
  /** 0–1 relative loudness within the voice. */
  velocity: number;
}

interface Chord {
  root: number; // MIDI, bass register
  minor: boolean;
}

const CHORDS: Chord[] = [
  { root: 45, minor: true }, // Am
  { root: 41, minor: false }, // F
  { root: 48, minor: false }, // C
  { root: 43, minor: false }, // G
];

const BASS_STEPS = [0, 3, 6, 8, 11, 14];
const BASS_OCTAVE_UP = new Set([6, 14]);
/** Which chord tone the arpeggio plays on each 8th; 3 = root an octave up. */
const ARP_SHAPE = [0, 1, 2, 3, 2, 1, 2, 3];

export const midiToFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export function chordTones({ root, minor }: Chord): number[] {
  return [root, root + (minor ? 3 : 4), root + 7, root + 12];
}

/** All notes that start on a given step of the loop. */
export function musicStep(step: number, intensity: 0 | 1 | 2): Note[] {
  const s = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  const bar = Math.floor(s / STEPS_PER_BAR);
  const inBar = s % STEPS_PER_BAR;
  const chord = CHORDS[bar];
  const tones = chordTones(chord);
  const notes: Note[] = [];

  if (inBar === 0) {
    for (const t of tones.slice(0, 3)) notes.push({ voice: 'pad', midi: t + 12, steps: STEPS_PER_BAR, velocity: 1 });
  }

  const arpEvery = intensity === 2 ? 1 : 2;
  if (inBar % arpEvery === 0 && (intensity > 0 || inBar % 4 === 0)) {
    const idx = ARP_SHAPE[Math.floor(inBar / 2) % ARP_SHAPE.length];
    const lift = intensity === 2 && inBar % 2 === 1 ? 12 : 0;
    notes.push({ voice: 'arp', midi: tones[idx] + 24 + lift, steps: 1, velocity: inBar % 4 === 0 ? 1 : 0.7 });
  }

  if (intensity >= 1) {
    if (BASS_STEPS.includes(inBar)) {
      notes.push({
        voice: 'bass',
        midi: chord.root + (BASS_OCTAVE_UP.has(inBar) ? 12 : 0),
        steps: 2,
        velocity: inBar === 0 ? 1 : 0.8,
      });
    }
    const kickSteps = intensity === 2 ? [0, 4, 8, 12] : [0, 8];
    if (kickSteps.includes(inBar)) notes.push({ voice: 'kick', midi: 0, steps: 1, velocity: 1 });
    const hat = intensity === 2 ? inBar % 2 === 1 : inBar % 4 === 2;
    if (hat) notes.push({ voice: 'hat', midi: 0, steps: 1, velocity: inBar % 4 === 2 ? 1 : 0.6 });
  }
  return notes;
}
