import type { BallKind } from '../game/Ball';
import type { PowerKind } from '../game/PowerUps';

/** "Neon circuit" palette: a dark board where sealed areas become live circuitry. */
export const T = {
  bg: '#060a14',
  bgInner: '#0b1324',
  gridLine: 'rgba(90,200,255,0.05)',
  gridDot: 'rgba(120,220,255,0.12)',
  frame: 'rgba(95,245,232,0.35)',

  filled: '#0d3340',
  filledDeep: '#0a2733',
  trace: 'rgba(70,220,205,0.38)',
  via: 'rgba(130,255,240,0.55)',
  edge: '#5ff5e8',
  edgeGlow: 'rgba(95,245,232,0.18)',
  wave: [190, 255, 248] as const,

  wallNeg: '#ffcf4a',
  wallPos: '#ff5f7e',
  danger: [255, 70, 90] as const,

  preview: 'rgba(220,240,255,0.4)',
  text: '#eef4ff',
  textDim: '#93a4c4',
  accent: '#ffcf4a',
  panel: 'rgba(9,14,28,0.86)',
  panelEdge: 'rgba(95,245,232,0.35)',
  scrim: 'rgba(4,7,15,0.62)',
};

export const BALL_COLORS: Record<BallKind, string> = {
  basic: '#eef2fa',
  heavy: '#8d97ab',
  glass: '#8fe3ff',
  splitter: '#ff9a4a',
  phantom: '#c39bff',
  shard: '#bdf0ff',
};

export const POWER_COLORS: Record<PowerKind, string> = {
  magnet: '#ff5a78',
  bomb: '#ff8a4c',
  multiplier: '#f5c84a',
  fast: '#5fd68a',
  freeze: '#7cc8ff',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export const REDUCED_MOTION =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
