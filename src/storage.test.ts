import { describe, expect, it } from 'vitest';
import {
  insertScore,
  type KeyValueStore,
  loadScores,
  loadSettings,
  MAX_SCORES,
  saveScores,
  saveSettings,
  type ScoreEntry,
  emptyTable,
} from './storage';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwingStore: KeyValueStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

const entry = (score: number): ScoreEntry => ({ score, level: 1, date: '2026-01-01T00:00:00.000Z' });

describe('insertScore', () => {
  it('keeps the list sorted and reports the rank', () => {
    let list: ScoreEntry[] = [];
    for (const s of [500, 900, 100]) list = insertScore(list, entry(s)).list;
    expect(list.map((e) => e.score)).toEqual([900, 500, 100]);
    expect(insertScore(list, entry(700)).rank).toBe(1);
    expect(insertScore(list, entry(1000)).rank).toBe(0);
  });

  it('caps the list and rejects scores that do not place', () => {
    let list: ScoreEntry[] = [];
    for (let i = 1; i <= MAX_SCORES; i++) list = insertScore(list, entry(i * 100)).list;
    const low = insertScore(list, entry(50));
    expect(low.rank).toBeNull();
    expect(low.list).toHaveLength(MAX_SCORES);
    const high = insertScore(list, entry(250));
    expect(high.list).toHaveLength(MAX_SCORES);
    expect(high.list.at(-1)!.score).toBe(200);
  });

  it('puts ties below the existing score and ignores zero', () => {
    const list = [entry(500)];
    expect(insertScore(list, entry(500)).rank).toBe(1);
    expect(insertScore(list, entry(0)).rank).toBeNull();
  });
});

describe('persistence', () => {
  it('round-trips scores and settings', () => {
    const store = memoryStore();
    const table = emptyTable();
    table.hard = [entry(1234)];
    saveScores(table, store);
    saveSettings({ difficulty: 'relaxed' }, store);
    expect(loadScores(store).hard[0].score).toBe(1234);
    expect(loadSettings(store).difficulty).toBe('relaxed');
  });

  it('drops corrupt or unexpected data', () => {
    const store = memoryStore();
    store.data.set('partition.scores', JSON.stringify({ normal: [entry(10), { score: 'x' }, null], bogus: [entry(5)] }));
    store.data.set('partition.settings', JSON.stringify({ difficulty: 'impossible' }));
    expect(loadScores(store).normal).toEqual([entry(10)]);
    expect(loadSettings(store).difficulty).toBe('normal');

    store.data.set('partition.scores', 'not json');
    store.data.set('partition.settings', 'null');
    expect(loadScores(store)).toEqual(emptyTable());
    expect(loadSettings(store).difficulty).toBe('normal');
  });

  it('works when storage is blocked', () => {
    expect(loadScores(throwingStore)).toEqual(emptyTable());
    expect(loadSettings(throwingStore).difficulty).toBe('normal');
    expect(saveScores(emptyTable(), throwingStore)).toBe(false);
    expect(loadScores(null)).toEqual(emptyTable());
  });
});
