import type { TextRun } from './types';

/**
 * PDFs store text in fragments (often one per word or even per glyph run).
 * Fragments that sit on the same baseline, in the same size, close to each
 * other are merged into one line, which is the natural unit to edit.
 */
export function mergeTextRuns(runs: readonly TextRun[]): TextRun[] {
  const sorted = [...runs].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const merged: TextRun[] = [];
  for (const run of sorted) {
    const previous = merged.at(-1);
    const gap = previous ? run.x - (previous.x + previous.width) : 0;
    const sameLine =
      previous !== undefined &&
      // Only ordinary horizontal text is joined; rotated fragments stay as they are.
      previous.angle === 0 &&
      run.angle === 0 &&
      Math.abs(previous.baseline - run.baseline) < 0.5 &&
      Math.abs(previous.fontSize - run.fontSize) < 0.1 &&
      previous.fontFamily === run.fontFamily &&
      gap > -run.fontSize * 0.3 &&
      gap < run.fontSize * 1.5;
    if (!previous || !sameLine) {
      merged.push({ ...run });
      continue;
    }
    // A visible gap between fragments is a word space, unless one is already there.
    const needsSpace = gap > run.fontSize * 0.15 && !/\s$/.test(previous.text) && !/^\s/.test(run.text);
    previous.text += (needsSpace ? ' ' : '') + run.text;
    previous.width = run.x + run.width - previous.x;
  }
  return merged;
}
