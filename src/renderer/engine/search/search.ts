import type { EditorObject } from '@shared/types/objects';
import type { TextRun } from '../pdf/types';

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface SearchHit {
  pageId: string;
  /** Area of the match in page space (points, origin top-left). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Text around the match, for the result list. */
  before: string;
  match: string;
  after: string;
  /** Whether the text belongs to the original page or to an object added in the editor. */
  source: 'page' | 'object';
  /** The line of page text the match is in, with the match offsets (page hits). */
  line?: TextRun;
  start: number;
  end: number;
  /** The object the match is in, and which of its matches this is (object hits). */
  objectId?: string;
  ordinal?: number;
}

const SNIPPET_CONTEXT = 28;
const WORD_CHARACTER = '[\\p{L}\\p{N}_]';

/** Builds the matcher for a query, or `null` when there is nothing to search for. */
export function createMatcher(query: string, { caseSensitive, wholeWord }: SearchOptions): RegExp | null {
  if (query.trim() === '') return null;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Unicode-aware boundaries and case folding, so Cyrillic behaves like Latin.
  const pattern = wholeWord ? `(?<!${WORD_CHARACTER})${escaped}(?!${WORD_CHARACTER})` : escaped;
  return new RegExp(pattern, caseSensitive ? 'gu' : 'giu');
}

/** Start and end offsets of every match in a string. */
export function findMatches(text: string, matcher: RegExp): Array<[start: number, end: number]> {
  const matches: Array<[number, number]> = [];
  matcher.lastIndex = 0;
  for (let result = matcher.exec(text); result !== null; result = matcher.exec(text)) {
    if (result[0].length === 0) {
      matcher.lastIndex += 1;
      continue;
    }
    matches.push([result.index, result.index + result[0].length]);
  }
  return matches;
}

function snippet(text: string, start: number, end: number): Pick<SearchHit, 'before' | 'match' | 'after'> {
  const from = Math.max(0, start - SNIPPET_CONTEXT);
  const to = Math.min(text.length, end + SNIPPET_CONTEXT);
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, start),
    match: text.slice(start, end),
    after: text.slice(end, to) + (to < text.length ? '…' : ''),
  };
}

/**
 * Bounding box of the stretch of a line between two distances along its
 * baseline, from just below the baseline to the top of the letters. For
 * rotated text this is the axis-aligned box around the slanted stretch.
 */
function runArea(run: TextRun, from: number, to: number): Pick<SearchHit, 'x' | 'y' | 'width' | 'height'> {
  const radians = (run.angle * Math.PI) / 180;
  const along = { x: Math.cos(radians), y: Math.sin(radians) };
  // "Up" from the baseline, perpendicular to the text direction (y points down on the page).
  const up = { x: along.y, y: -along.x };
  const corners = [from, to].flatMap((distance) =>
    [-0.3, 0.9].map((rise) => ({
      x: run.x + along.x * distance + up.x * run.fontSize * rise,
      y: run.baseline + along.y * distance + up.y * run.fontSize * rise,
    })),
  );
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Finds a query in the lines of original text of a page. The highlighted area
 * is estimated from the character positions within the line, which is exact
 * for monospaced text and close for proportional fonts.
 */
export function searchRuns(pageId: string, runs: readonly TextRun[], matcher: RegExp): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const run of runs) {
    const length = run.text.length;
    if (length === 0) continue;
    for (const [start, end] of findMatches(run.text, matcher)) {
      hits.push({
        pageId,
        ...runArea(run, (run.width * start) / length, (run.width * end) / length),
        ...snippet(run.text, start, end),
        source: 'page',
        line: run,
        start,
        end,
      });
    }
  }
  return hits;
}

/** Finds a query in text objects; the whole object is highlighted. */
export function searchObjects(pageId: string, objects: readonly EditorObject[], matcher: RegExp): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const object of objects) {
    if (object.type !== 'text') continue;
    const text = object.text.replace(/\s+/g, ' ');
    for (const [ordinal, [start, end]] of findMatches(text, matcher).entries()) {
      hits.push({
        pageId,
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        ...snippet(text, start, end),
        source: 'object',
        start,
        end,
        objectId: object.id,
        ordinal,
      });
    }
  }
  return hits;
}
