import type { EditorObject, TextObject } from '@shared/types/objects';
import { resolveObjects } from '../../engine/layers/layerOperations';
import { createReplacement, isRunCovered } from '../../engine/objects/replacement';
import type { TextRun } from '../../engine/pdf/types';
import { samplePageColors } from '../../engine/rendering/sampleColors';
import { getTextRuns } from '../../engine/rendering/pageRenderer';
import { createMatcher, findMatches, searchObjects, searchRuns, type SearchHit } from '../../engine/search/search';
import { getActiveDocument, getDocument } from '../../stores/documentsStore';
import { useSearchStore } from '../../stores/searchStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useToolStore } from '../../stores/toolStore';
import { useUiStore } from '../../stores/uiStore';
import { i18n } from '../../localization/i18n';
import { goToPage } from '../documents/documentActions';
import { applyObjectChanges, objectsOnPage, type ObjectChange } from '../pdf-editor/objectActions';

/** Pages searched between two updates of the result list. */
const BATCH_SIZE = 20;
let generation = 0;

/**
 * Searches the active document for the current query. Pages are read one
 * after another without blocking the interface; a newer search (or a change
 * of the document) cancels the one in progress.
 */
export async function runSearch(): Promise<void> {
  const run = (generation += 1);
  const { query, caseSensitive, wholeWord, setResults } = useSearchStore.getState();
  const document = getActiveDocument();
  if (!document) {
    useSearchStore.setState({ hits: [], active: -1, searching: false, documentId: null });
    return;
  }
  const matcher = createMatcher(query, { caseSensitive, wholeWord });
  if (!matcher) {
    setResults(document.id, [], false);
    return;
  }

  const hits: SearchHit[] = [];
  setResults(document.id, hits, true);
  for (const [index, page] of document.pages.entries()) {
    const runs = page.source.kind === 'pdf' ? await getTextRuns(page.source.sourceId, page.source.pageIndex).catch(() => []) : [];
    if (run !== generation) return;
    const pageObjects = document.objects[page.id] ?? [];
    // Original lines hidden under a replacement are no longer what the reader sees;
    // text recognised by OCR is searched like real text.
    const lines = [...runs, ...(document.recognised[page.id] ?? [])].filter((line) => !isRunCovered(line, pageObjects));
    hits.push(...searchRuns(page.id, lines, matcher));
    // Objects on hidden layers are not on the page as far as the reader is concerned.
    const visible = resolveObjects(document.layers[page.id] ?? [], document.objects[page.id] ?? []).map((entry) => entry.object);
    hits.push(...searchObjects(page.id, visible, matcher));
    if ((index + 1) % BATCH_SIZE === 0) setResults(document.id, [...hits], true);
  }
  if (run === generation) setResults(document.id, hits, false);
}

/** Makes a result the current one and shows its page. */
export function activateHit(index: number): void {
  const { hits, documentId, setActive } = useSearchStore.getState();
  const hit = hits[index];
  const document = documentId ? getDocument(documentId) : null;
  if (!hit || !document) return;
  setActive(index);
  const pageIndex = document.pages.findIndex((page) => page.id === hit.pageId);
  if (pageIndex !== -1) goToPage(pageIndex, document.id);
}

export function stepHit(direction: 1 | -1): void {
  const { hits, active } = useSearchStore.getState();
  if (hits.length === 0) return;
  activateHit((active + direction + hits.length) % hits.length);
}

/** Opens the search panel and puts the cursor in the search field. */
export function openSearch(): void {
  useSettingsStore.getState().update({ layout: { leftCollapsed: false, leftTab: 'search' } });
  useSearchStore.getState().requestFocus();
}

/** Replaces the given character ranges of a string (non-overlapping, in any order). */
export function replaceRanges(text: string, ranges: ReadonlyArray<readonly [number, number]>, replacement: string): string {
  let result = text;
  for (const [start, end] of [...ranges].sort((a, b) => b[0] - a[0])) {
    result = result.slice(0, start) + replacement + result.slice(end);
  }
  return result;
}

/**
 * Replaces search results with `replacement`. Text of objects added in the
 * editor is changed directly. Original page text cannot be changed in place:
 * its line is covered and a text object with the new wording is put on top
 * (overlay replacement), which only works for upright lines.
 *
 * All replacements of one call are a single undo step. Returns how many
 * matches were replaced and how many had to be skipped.
 */
export async function replaceHits(indexes: readonly number[], replacement: string): Promise<{ replaced: number; skipped: number }> {
  const { hits, documentId, query, caseSensitive, wholeWord } = useSearchStore.getState();
  const document = documentId ? getDocument(documentId) : null;
  const matcher = createMatcher(query, { caseSensitive, wholeWord });
  if (!document || !matcher) return { replaced: 0, skipped: 0 };
  const chosen = indexes.map((index) => hits[index]).filter((hit): hit is SearchHit => hit !== undefined);

  const changes = new Map<string, Required<ObjectChange>>();
  const changeFor = (pageId: string): Required<ObjectChange> => {
    let change = changes.get(pageId);
    if (!change) {
      change = { pageId, add: [], replace: [] };
      changes.set(pageId, change);
    }
    return change;
  };
  let replaced = 0;
  let skipped = 0;

  // --- Text objects: edit the text itself --------------------------------------------------
  const byObject = new Map<string, SearchHit[]>();
  for (const hit of chosen) {
    if (hit.source === 'object' && hit.objectId) byObject.set(hit.objectId, [...(byObject.get(hit.objectId) ?? []), hit]);
  }
  for (const [objectId, objectHits] of byObject) {
    const pageId = objectHits[0]!.pageId;
    const object = objectsOnPage(document, pageId).find((candidate): candidate is TextObject => candidate.id === objectId && candidate.type === 'text');
    if (!object) {
      skipped += objectHits.length;
      continue;
    }
    const matches = findMatches(object.text, matcher);
    const wanted = new Set(objectHits.map((hit) => hit.ordinal));
    const ranges = matches.filter((_, ordinal) => wanted.has(ordinal));
    if (ranges.length === 0) {
      skipped += objectHits.length;
      continue;
    }
    changeFor(pageId).replace.push({ ...object, text: replaceRanges(object.text, ranges, replacement) });
    replaced += ranges.length;
  }

  // --- Original page text: cover the line and put the new wording on top ---------------------
  const byLine = new Map<TextRun, SearchHit[]>();
  for (const hit of chosen) {
    if (hit.source === 'page' && hit.line) byLine.set(hit.line, [...(byLine.get(hit.line) ?? []), hit]);
  }
  const { style } = useToolStore.getState();
  for (const [line, lineHits] of byLine) {
    const page = document.pages.find((candidate) => candidate.id === lineHits[0]!.pageId);
    if (!page || line.angle !== 0) {
      // Slanted or rotated text cannot be covered by an upright text box.
      skipped += lineHits.length;
      continue;
    }
    const text = replaceRanges(line.text, lineHits.map((hit) => [hit.start, hit.end] as const), replacement);
    const template = createReplacement(line, { background: '#ffffff', foreground: '#000000' }, style, text);
    const colors = await samplePageColors(document.id, page, template);
    const object: EditorObject = { ...template, color: colors.foreground, background: colors.background };
    changeFor(page.id).add.push(object);
    replaced += lineHits.length;
  }

  if (changes.size > 0) applyObjectChanges(document.id, [...changes.values()]);
  if (skipped > 0) {
    useUiStore.getState().showNotice({ titleKey: 'search.replaceTitle', lines: [i18n.t('search.replaceSkipped', { count: skipped })] });
  }
  return { replaced, skipped };
}

/** Replaces the current result and moves on. */
export async function replaceCurrent(replacement: string): Promise<void> {
  const { active } = useSearchStore.getState();
  if (active >= 0) await replaceHits([active], replacement);
}

/** Replaces every result after the user has confirmed the number of replacements. */
export async function replaceAll(replacement: string): Promise<void> {
  const { hits } = useSearchStore.getState();
  if (hits.length === 0) return;
  const answer = await useUiStore.getState().confirm({
    title: i18n.t('search.replaceTitle'),
    message: i18n.t('search.replaceAllMessage', { count: hits.length }),
    confirmLabel: i18n.t('search.replaceAll'),
  });
  if (answer === 'confirm') await replaceHits(hits.map((_, index) => index), replacement);
}
