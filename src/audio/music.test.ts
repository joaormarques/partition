import { describe, expect, it } from 'vitest';
import { LOOP_STEPS, midiToFreq, musicStep, STEP_SECONDS, STEPS_PER_BAR } from './music';

const allSteps = (intensity: 0 | 1 | 2) => Array.from({ length: LOOP_STEPS }, (_, s) => musicStep(s, intensity)).flat();

describe('music', () => {
  it('converts MIDI to frequency', () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(midiToFreq(57)).toBeCloseTo(220);
    expect(midiToFreq(81)).toBeCloseTo(880);
  });

  it('runs at a sensible tempo', () => {
    expect(STEP_SECONDS * STEPS_PER_BAR).toBeGreaterThan(1.5);
    expect(STEP_SECONDS * STEPS_PER_BAR).toBeLessThan(3);
  });

  it('menu music has no drums or bass', () => {
    const voices = new Set(allSteps(0).map((n) => n.voice));
    expect(voices.has('kick')).toBe(false);
    expect(voices.has('bass')).toBe(false);
    expect(voices.has('pad')).toBe(true);
  });

  it('higher intensity adds layers and density', () => {
    const one = allSteps(1);
    const two = allSteps(2);
    expect(new Set(one.map((n) => n.voice))).toEqual(new Set(['pad', 'arp', 'bass', 'kick', 'hat']));
    expect(two.filter((n) => n.voice === 'kick').length).toBe(2 * one.filter((n) => n.voice === 'kick').length);
    expect(two.length).toBeGreaterThan(one.length);
  });

  it('starts each bar with a pad chord and a bass root', () => {
    for (let bar = 0; bar < LOOP_STEPS / STEPS_PER_BAR; bar++) {
      const notes = musicStep(bar * STEPS_PER_BAR, 1);
      expect(notes.filter((n) => n.voice === 'pad')).toHaveLength(3);
      expect(notes.some((n) => n.voice === 'bass')).toBe(true);
    }
  });

  it('loops seamlessly and keeps notes in a playable range', () => {
    expect(musicStep(LOOP_STEPS + 5, 2)).toEqual(musicStep(5, 2));
    for (const n of allSteps(2)) {
      if (n.voice === 'kick' || n.voice === 'hat') continue;
      expect(n.midi).toBeGreaterThanOrEqual(36);
      expect(n.midi).toBeLessThanOrEqual(96);
      expect(n.velocity).toBeGreaterThan(0);
    }
  });
});
