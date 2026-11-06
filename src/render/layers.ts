import { CELL, COLS, HEIGHT, ROWS, WIDTH } from '../game/constants';
import { EMPTY, type Grid } from '../game/Grid';
import { T } from './theme';

function makeCanvas(dpr: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [canvas, ctx];
}

/** Static board: vignette, faint grid and intersection dots. Drawn once per pixel ratio. */
export class BackgroundLayer {
  private canvas: HTMLCanvasElement | null = null;
  private dpr = 0;

  get(dpr: number): HTMLCanvasElement {
    if (this.canvas && this.dpr === dpr) return this.canvas;
    const [canvas, ctx] = makeCanvas(dpr);
    const g = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 40, WIDTH / 2, HEIGHT / 2, WIDTH * 0.7);
    g.addColorStop(0, T.bgInner);
    g.addColorStop(1, T.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.strokeStyle = T.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) {
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, HEIGHT);
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.moveTo(0, y * CELL + 0.5);
      ctx.lineTo(WIDTH, y * CELL + 0.5);
    }
    ctx.stroke();

    ctx.fillStyle = T.gridDot;
    for (let y = 2; y < ROWS; y += 2) {
      for (let x = 2; x < COLS; x += 2) ctx.fillRect(x * CELL - 0.5, y * CELL - 0.5, 2, 2);
    }
    this.canvas = canvas;
    this.dpr = dpr;
    return canvas;
  }
}

function hash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Filled cells drawn as circuitry: traces that join neighbouring filled cells,
 * vias and chips, plus a glowing edge wherever a filled cell meets open board.
 * Re-rendered only when the grid changes.
 */
export class FieldLayer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private grid: Grid | null = null;
  private version = -1;
  private dpr = 0;

  get(grid: Grid, dpr: number): HTMLCanvasElement {
    if (!this.canvas || this.dpr !== dpr) {
      [this.canvas, this.ctx] = makeCanvas(dpr);
      this.dpr = dpr;
      this.version = -1;
    }
    if (grid !== this.grid || grid.version !== this.version) {
      this.render(grid, this.ctx!);
      this.grid = grid;
      this.version = grid.version;
    }
    return this.canvas;
  }

  private render(grid: Grid, ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const filled = (x: number, y: number) => grid.inBounds(x, y) && grid.get(x, y) !== EMPTY;
    const open = (x: number, y: number) => grid.inBounds(x, y) && grid.get(x, y) === EMPTY;

    // Base plates, with a slightly deeper tone on a checker of 4×4 blocks.
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!filled(x, y)) continue;
        ctx.fillStyle = ((x >> 2) + (y >> 2)) % 2 === 0 ? T.filled : T.filledDeep;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }

    // Traces between filled neighbours.
    ctx.strokeStyle = T.trace;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!filled(x, y)) continue;
        const h = hash(x, y);
        const cx = x * CELL + CELL / 2;
        const cy = y * CELL + CELL / 2;
        if ((h & 3) === 0 && filled(x + 1, y)) {
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + CELL, cy);
        }
        if (((h >>> 2) & 3) === 0 && filled(x, y + 1)) {
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx, cy + CELL);
        }
      }
    }
    ctx.stroke();

    // Vias and chips.
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!filled(x, y)) continue;
        const h = hash(x, y);
        const cx = x * CELL + CELL / 2;
        const cy = y * CELL + CELL / 2;
        if (((h >>> 4) & 7) === 0) {
          ctx.strokeStyle = T.via;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
          ctx.stroke();
        } else if (((h >>> 7) & 31) === 0) {
          ctx.fillStyle = T.via;
          ctx.fillRect(cx - 3, cy - 3, 6, 6);
        }
      }
    }

    // Glowing edges where filled meets open board.
    const edges = new Path2D();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!filled(x, y)) continue;
        const px = x * CELL;
        const py = y * CELL;
        if (open(x - 1, y)) {
          edges.moveTo(px + 1, py);
          edges.lineTo(px + 1, py + CELL);
        }
        if (open(x + 1, y)) {
          edges.moveTo(px + CELL - 1, py);
          edges.lineTo(px + CELL - 1, py + CELL);
        }
        if (open(x, y - 1)) {
          edges.moveTo(px, py + 1);
          edges.lineTo(px + CELL, py + 1);
        }
        if (open(x, y + 1)) {
          edges.moveTo(px, py + CELL - 1);
          edges.lineTo(px + CELL, py + CELL - 1);
        }
      }
    }
    ctx.lineCap = 'square';
    ctx.strokeStyle = T.edgeGlow;
    ctx.lineWidth = 6;
    ctx.stroke(edges);
    ctx.strokeStyle = T.edge;
    ctx.lineWidth = 2;
    ctx.stroke(edges);
  }
}
