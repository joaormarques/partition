import type { Rect } from './Ball';
import { CELL } from './constants';
import type { Grid } from './Grid';

export type Orientation = 'h' | 'v';
export type HalfState = 'growing' | 'done' | 'broken';

/**
 * One half of a wall. The negative half starts on the origin cell and grows
 * toward lower x/y; the positive half starts on the next cell and grows the
 * other way. Each half lives or dies on its own.
 */
export class WallHalf {
  /** Length in cells (fractional while growing). */
  progress = 0;
  /** Number of cells this half has entered. */
  entered = 0;
  state: HalfState = 'growing';
  /** Built with a magnet charge: repels balls while growing. */
  magnetic = false;

  constructor(
    readonly ox: number,
    readonly oy: number,
    readonly orient: Orientation,
    readonly dir: -1 | 1,
  ) {}

  /** Grid cell for the k-th cell of this half. */
  cellAt(k: number): [number, number] {
    const offset = this.dir === -1 ? -k : 1 + k;
    return this.orient === 'h' ? [this.ox + offset, this.oy] : [this.ox, this.oy + offset];
  }

  coveredCells(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let k = 0; k < this.entered; k++) out.push(this.cellAt(k));
    return out;
  }

  /** Pixel rectangle covered so far. */
  rect(): Rect {
    const len = this.progress * CELL;
    if (this.orient === 'h') {
      const edge = (this.ox + 1) * CELL;
      return { x: this.dir === -1 ? edge - len : edge, y: this.oy * CELL, w: len, h: CELL };
    }
    const edge = (this.oy + 1) * CELL;
    return { x: this.ox * CELL, y: this.dir === -1 ? edge - len : edge, w: CELL, h: len };
  }

  /**
   * Grow by `cellsPerSecond * dt`; stops (state = 'done') at the first solid
   * cell. Returns true on the step the half finishes.
   */
  grow(grid: Grid, cellsPerSecond: number, dt: number): boolean {
    if (this.state !== 'growing') return false;
    const target = this.progress + cellsPerSecond * dt;
    while (target > this.entered) {
      const [x, y] = this.cellAt(this.entered);
      if (grid.isSolid(x, y)) {
        this.progress = this.entered;
        this.state = 'done';
        return true;
      }
      this.entered++;
    }
    this.progress = target;
    return false;
  }
}
