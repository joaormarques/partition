import { type Difficulty, DIFFICULTY_ORDER, isDifficulty } from './game/difficulty';

/**
 * localStorage can be missing, full or blocked (private windows, previews),
 * so every read and write is guarded and the game works without it.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadJSON<T>(key: string, fallback: T, store = defaultStore()): T {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown, store = defaultStore()): boolean {
  try {
    if (!store) return false;
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ── High scores ─────────────────────────────────────────────────────────────

export interface ScoreEntry {
  score: number;
  level: number;
  /** ISO date. */
  date: string;
}

export type ScoreTable = Record<Difficulty, ScoreEntry[]>;

export const MAX_SCORES = 5;
const SCORES_KEY = 'partition.scores';
const SETTINGS_KEY = 'partition.settings';

export function emptyTable(): ScoreTable {
  return { relaxed: [], normal: [], hard: [] };
}

function isEntry(v: unknown): v is ScoreEntry {
  const e = v as ScoreEntry;
  return !!e && Number.isFinite(e.score) && Number.isFinite(e.level) && typeof e.date === 'string';
}

/** Insert a score; returns the new list and its 0-based rank, or null if it didn't place. */
export function insertScore(list: readonly ScoreEntry[], entry: ScoreEntry): { list: ScoreEntry[]; rank: number | null } {
  if (entry.score <= 0) return { list: [...list], rank: null };
  // Ties go below existing entries: the earlier score keeps its place.
  let rank = list.findIndex((e) => entry.score > e.score);
  if (rank === -1) rank = list.length;
  if (rank >= MAX_SCORES) return { list: [...list], rank: null };
  const next = [...list.slice(0, rank), entry, ...list.slice(rank)].slice(0, MAX_SCORES);
  return { list: next, rank };
}

export function loadScores(store = defaultStore()): ScoreTable {
  const raw = loadJSON<Record<string, unknown> | null>(SCORES_KEY, {}, store);
  const table = emptyTable();
  if (!raw || typeof raw !== 'object') return table;
  for (const d of DIFFICULTY_ORDER) {
    const list = raw[d];
    if (Array.isArray(list)) {
      table[d] = list
        .filter(isEntry)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_SCORES);
    }
  }
  return table;
}

export function saveScores(table: ScoreTable, store = defaultStore()): boolean {
  return saveJSON(SCORES_KEY, table, store);
}

export interface Settings {
  difficulty: Difficulty;
}

export function loadSettings(store = defaultStore()): Settings {
  const raw = loadJSON<Partial<Settings> | null>(SETTINGS_KEY, {}, store);
  return { difficulty: isDifficulty(raw?.difficulty) ? raw.difficulty : 'normal' };
}

export function saveSettings(settings: Settings, store = defaultStore()): boolean {
  return saveJSON(SETTINGS_KEY, settings, store);
}
