export type Difficulty = 'relaxed' | 'normal' | 'hard';

export interface DifficultySpec {
  label: string;
  blurb: string;
  /** Multiplies every ball's speed. */
  speedScale: number;
  /** Added to the usual level + 1 lives (never below 1). */
  extraLives: number;
  /** Fraction of the board to fill to clear a level. */
  winFill: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultySpec> = {
  relaxed: {
    label: 'Relaxed',
    blurb: 'Slower balls, two extra lives, clear at 70%.',
    speedScale: 0.8,
    extraLives: 2,
    winFill: 0.7,
  },
  normal: {
    label: 'Normal',
    blurb: 'The intended balance. Clear at 75%.',
    speedScale: 1,
    extraLives: 0,
    winFill: 0.75,
  },
  hard: {
    label: 'Hard',
    blurb: 'Faster balls, one fewer life, clear at 80%.',
    speedScale: 1.2,
    extraLives: -1,
    winFill: 0.8,
  },
};

export const DIFFICULTY_ORDER: Difficulty[] = ['relaxed', 'normal', 'hard'];

export function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === 'string' && v in DIFFICULTIES;
}
