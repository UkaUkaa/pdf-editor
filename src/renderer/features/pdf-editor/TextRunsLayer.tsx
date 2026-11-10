import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DocumentModel, PageModel } from '@shared/types/document';
import type { ShapeObject, ToolStyle } from '@shared/types/objects';
import { createShapeObject } from '../../engine/objects/factory';
import { createReplacement, isRunCovered, runBox } from '../../engine/objects/replacement';
import type { TextRun } from '../../engine/pdf/types';
import { getTextRuns } from '../../engine/rendering/pageRenderer';
import { samplePageColors } from '../../engine/rendering/sampleColors';
import { useToolStore } from '../../stores/toolStore';
import { activateTool, addObject, selectObjects, startTextEditing } from './objectActions';

export type TextRunsMode = 'replace' | 'underline' | 'strikethrough' | 'markText';

/**
 * Builds the mark for a stretch of a text line, between two x positions in
 * page space: a line under or through the text, or a translucent band over it.
 */
export function createMarkup(run: TextRun, mode: Exclude<TextRunsMode, 'replace'>, from: number, to: number, style: ToolStyle): ShapeObject {
  const start = Math.max(run.x, Math.min(from, to));
  const end = Math.min(run.x + run.width, Math.max(from, to));
  // A click (or a drag outside the line) marks the whole line.
  const [x0, x1] = end - start < 3 ? [run.x, run.x + run.width] : [start, end];
  if (mode === 'markText') {
    return {
      ...createShapeObject('rect', { x: x0, y: run.baseline - run.fontSize * 0.85 }, { x: x1, y: run.baseline + run.fontSize * 0.22 }, style),
      stroke: null,
      fill: style.highlightColor,
      opacity: 0.4,
    };
  }
  const y = mode === 'underline' ? run.baseline + run.fontSize * 0.12 : run.baseline - run.fontSize * 0.3;
  return {
    ...createShapeObject('line', { x: x0, y }, { x: x1, y }, style),
    strokeWidth: Math.max(0.75, run.fontSize * 0.07),
  };
}

interface TextRunsLayerProps {
  document: DocumentModel;
  page: PageModel;
  unit: number;
  mode: TextRunsMode;
  /** Converts a pointer position to page space. */
  toPage: (event: { clientX: number; clientY: number }) => { x: number; y: number };
}

/**
 * Shown while a text tool is active: outlines the lines of original text that
 * can be replaced ("edit text") or marked (underline, strikethrough, highlight).
 */
export function TextRunsLayer({ document: doc, page, unit, mode, toPage }: TextRunsLayerProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<TextRun[]>([]);
  const dragStart = useRef<number | null>(null);
  const source = page.source;
  const sourceId = source.kind === 'pdf' ? source.sourceId : null;
  const sourcePage = source.kind === 'pdf' ? source.pageIndex : -1;

  useEffect(() => {
    if (!sourceId) return;
    let active = true;
    getTextRuns(sourceId, sourcePage).then(
      (found) => {
        if (active) setRuns(found);
      },
      (error: unknown) => console.error('Cannot read the text of the page', error),
    );
    return () => {
      active = false;
    };
  }, [sourceId, sourcePage]);

  // Lines recognised by OCR can be replaced and marked just like real text.
  const lines = [...runs, ...(doc.recognised[page.id] ?? [])];
  if (lines.length === 0) return null;
  const pageObjects = doc.objects[page.id] ?? [];

  return (
    <g className="text-runs" data-mode={mode}>
      {lines.map((run, index) => {
        // Only upright text can be replaced or marked by axis-aligned objects.
        if (run.angle !== 0) return null;
        const box = runBox(run);
        // A line that already has a replacement is edited through that object instead.
        if (mode === 'replace' && isRunCovered(run, pageObjects)) return null;
        return (
          <rect
            key={index}
            className="text-run"
            {...box}
            strokeWidth={unit}
            data-text-run={run.text}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              event.preventDefault();
              if (mode !== 'replace') {
                event.currentTarget.setPointerCapture?.(event.pointerId);
                dragStart.current = toPage(event).x;
                return;
              }
              void samplePageColors(doc.id, page, box).then((colors) => {
                const replacement = createReplacement(run, colors, useToolStore.getState().style);
                addObject(doc.id, page.id, replacement);
                activateTool('select');
                startTextEditing(doc.id, page.id, replacement);
              });
            }}
            onPointerUp={(event) => {
              if (mode === 'replace' || dragStart.current === null) return;
              const from = dragStart.current;
              dragStart.current = null;
              addObject(doc.id, page.id, createMarkup(run, mode, from, toPage(event).x, useToolStore.getState().style));
              // Keep the tool for the next line; a selection frame would only be in the way.
              selectObjects(doc.id, []);
            }}
          >
            <title>{t(mode === 'replace' ? 'editor.replaceTextHint' : 'editor.markTextHint')}</title>
          </rect>
        );
      })}
    </g>
  );
}
