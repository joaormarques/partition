export const EMPTY = 0;
export const FILLED = 1;

/** The playfield. Anything outside the bounds counts as filled (solid). */
export class Grid {
  readonly cells: Uint8Array;
  /** Bumped on every change, so renderers can cache. */
  version = 0;

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.cells = new Uint8Array(cols * rows);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  index(x: number, y: number): number {
    return y * this.cols + x;
  }

  get(x: number, y: number): number {
    return this.inBounds(x, y) ? this.cells[this.index(x, y)] : FILLED;
  }

  set(x: number, y: number, value: number): void {
    if (!this.inBounds(x, y)) return;
    this.cells[this.index(x, y)] = value;
    this.version++;
  }

  isSolid(x: number, y: number): boolean {
    return this.get(x, y) !== EMPTY;
  }

  filledCount(): number {
    let n = 0;
    for (const c of this.cells) if (c !== EMPTY) n++;
    return n;
  }

  fillRatio(): number {
    return this.filledCount() / this.cells.length;
  }

  /**
   * Fill every empty region that contains none of the seed cells (the balls).
   * Returns the indices of the cells that were filled.
   */
  fillUnreachable(seeds: ReadonlyArray<readonly [number, number]>): number[] {
    const { cols, cells } = this;
    const visited = new Uint8Array(cells.length);
    const stack: number[] = [];

    const visit = (x: number, y: number) => {
      if (!this.inBounds(x, y)) return;
      const i = this.index(x, y);
      if (cells[i] !== EMPTY || visited[i]) return;
      visited[i] = 1;
      stack.push(i);
    };

    for (const [x, y] of seeds) visit(x, y);

    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % cols;
      const y = (i / cols) | 0;
      visit(x + 1, y);
      visit(x - 1, y);
      visit(x, y + 1);
      visit(x, y - 1);
    }

    const filled: number[] = [];
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === EMPTY && !visited[i]) {
        cells[i] = FILLED;
        filled.push(i);
      }
    }
    if (filled.length > 0) this.version++;
    return filled;
  }
}
