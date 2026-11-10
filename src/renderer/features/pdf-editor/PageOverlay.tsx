import { useEffect, useRef, useState } from 'react';
import { CSS_FONT_FAMILY } from '@shared/fonts';
import type { DocumentModel, PageModel } from '@shared/types/document';
import type { Layer } from '@shared/types/layers';
import {
  MIN_OBJECT_SIZE,
  NOTE_SIZE,
  TEXT_PADDING,
  type EditorObject,
  type ShapeKind,
  type TextObject,
} from '@shared/types/objects';
import { displaySize, pageGeometry, type Point } from '../../engine/coordinates/pageCoordinates';
import {
  CLICK_TOLERANCE,
  createPathObject,
  createShapeObject,
  createTextObject,
  fitTextHeight,
} from '../../engine/objects/factory';
import { expandToGroups, resolveObjects } from '../../engine/layers/layerOperations';
import {
  boundsOf,
  boxesIntersect,
  boxFromPoints,
  displayToPage,
  pageRotationTransform,
  resizeObject,
  rotationTowards,
  translate,
  type Box,
  type ResizeHandle,
} from '../../engine/objects/geometry';
import { useDocumentsStore } from '../../stores/documentsStore';
import { useSearchStore } from '../../stores/searchStore';
import { useToolStore } from '../../stores/toolStore';
import {
  activateTool,
  addObject,
  deleteObjects,
  finishTextEditing,
  replaceObjects,
  selectObjects,
  startTextEditing,
} from './objectActions';
import { ObjectView, objectTransform } from './ObjectView';
import { createLink, createNote, followLink } from '../comments/commentActions';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { TextRunsLayer, type TextRunsMode } from './TextRunsLayer';

const NO_OBJECTS: EditorObject[] = [];
const NO_IDS: string[] = [];
const NO_LAYERS: Layer[] = [];
const NO_HITS: never[] = [];
const SHAPE_TOOLS: ReadonlySet<string> = new Set(['rect', 'ellipse', 'line', 'arrow']);
const ALL_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** Text boxes only change width; their height follows the text. */
const TEXT_HANDLES: ResizeHandle[] = ['e', 'w'];
/** Tools that work on the lines of original text, and what they do with a line. */
const TEXT_TOOL_MODES: Partial<Record<string, TextRunsMode>> = {
  editText: 'replace',
  underline: 'underline',
  strikethrough: 'strikethrough',
  markText: 'markText',
};

type Drag =
  | { kind: 'move'; start: Point; originals: EditorObject[]; moved: boolean }
  | { kind: 'resize'; handle: ResizeHandle; original: EditorObject }
  | { kind: 'rotate'; original: EditorObject }
  | { kind: 'marquee'; start: Point }
  | { kind: 'create'; shape: ShapeKind; start: Point }
  | { kind: 'link'; start: Point }
  | { kind: 'draw'; points: Point[] };

type Preview =
  { kind: 'marquee'; box: Box } | { kind: 'shape'; object: EditorObject } | { kind: 'draw'; points: Point[] };

/** Static rendering of a page's objects, e.g. for thumbnails. */
export function PageObjectsPreview({
  page,
  objects,
  layers,
}: {
  page: PageModel;
  objects: readonly EditorObject[];
  layers: readonly Layer[];
}): React.JSX.Element | null {
  const resolved = resolveObjects(layers, objects);
  if (resolved.length === 0) return null;
  const display = displaySize(pageGeometry(page));
  return (
    <svg className="page-overlay page-overlay--static" viewBox={`0 0 ${display.width} ${display.height}`} aria-hidden>
      <g transform={pageRotationTransform(page.box, page.rotation)}>
        {resolved.map(({ object }) => (
          <ObjectView key={object.id} object={object} />
        ))}
      </g>
    </svg>
  );
}

interface TextEditorProps {
  object: TextObject;
  /** Points per CSS pixel, for hairlines that stay one pixel wide at any zoom. */
  unit: number;
  /** Text typed so far; it lives in the tool store so it survives the page being scrolled away. */
  text: string;
}

/** Inline editor shown in place of a text object while its text is typed. */
function TextEditor({ object, unit, text }: TextEditorProps): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = ref.current;
    element?.focus();
    element?.setSelectionRange(element.value.length, element.value.length);
  }, []);

  // Grow with the text; one spare line keeps the caret visible after a line break.
  const height = fitTextHeight({ ...object, text }).height + object.fontSize * object.lineHeight;
  return (
    <g transform={objectTransform(object)}>
      <foreignObject x={0} y={0} width={object.width} height={height}>
        <textarea
          ref={ref}
          className="text-editor"
          value={text}
          spellCheck={false}
          style={{
            padding: TEXT_PADDING,
            fontFamily: `"${CSS_FONT_FAMILY[object.fontFamily]}"`,
            fontSize: object.fontSize,
            fontWeight: object.bold ? 700 : 400,
            fontStyle: object.italic ? 'italic' : 'normal',
            lineHeight: object.lineHeight,
            textAlign: object.align,
            color: object.color,
            background: object.background ?? 'transparent',
            outlineWidth: unit,
          }}
          onChange={(event) => useToolStore.getState().setEditingText(event.target.value)}
          onBlur={finishTextEditing}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            // Keys typed here are text, not shortcuts of the viewer.
            event.stopPropagation();
            if (event.key === 'Escape') event.currentTarget.blur();
          }}
        />
      </foreignObject>
    </g>
  );
}

interface PageOverlayProps {
  document: DocumentModel;
  page: PageModel;
  /** CSS pixels per PDF point at the current zoom. */
  scale: number;
}

/**
 * Editing canvas of one page: draws the page's objects as SVG on top of the
 * rendered page and turns pointer gestures into undoable changes.
 */
export function PageOverlay({ document: doc, page, scale }: PageOverlayProps): React.JSX.Element {
  const tool = useToolStore((state) => state.tool);
  const editingState = useToolStore((state) => state.editing);
  const editingId =
    editingState?.documentId === doc.id && editingState.pageId === page.id ? editingState.objectId : null;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<Map<string, EditorObject> | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const searchHits = useSearchStore((state) => (state.documentId === doc.id ? state.hits : NO_HITS));
  const activeHit = useSearchStore((state) => state.hits[state.active]);
  const objects = doc.objects[page.id] ?? NO_OBJECTS;
  const layers = doc.layers[page.id] ?? NO_LAYERS;
  const pageIndex = doc.pages.indexOf(page);
  const isCurrent = doc.view.currentPage === pageIndex;
  const selectedIds = isCurrent ? doc.selectedObjects : NO_IDS;
  const display = displaySize(pageGeometry(page));
  const unit = 1 / scale;
  const interactiveIds = new Set(
    resolveObjects(layers, objects)
      .filter((entry) => entry.interactive)
      .map((entry) => entry.object.id),
  );
  const interactive = objects.filter((object) => interactiveIds.has(object.id));

  const toPage = (event: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return displayToPage(
      {
        x: ((event.clientX - rect.left) / rect.width) * display.width,
        y: ((event.clientY - rect.top) / rect.height) * display.height,
      },
      page.box,
      page.rotation,
    );
  };

  const makeCurrent = (): void => {
    if (!isCurrent) useDocumentsStore.getState().updateView(doc.id, { currentPage: pageIndex });
  };

  const finish = (): void => {
    drag.current = null;
    setDraft(null);
    setPreview(null);
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    // Text tools are handled by the layer of text lines; the hand tool by the viewer.
    if (event.button !== 0 || tool === 'hand' || tool in TEXT_TOOL_MODES) return;
    const target = event.target as Element;
    const point = toPage(event);
    const handle = target.closest<SVGElement>('[data-handle]')?.dataset['handle'];
    const hitId = target.closest<SVGElement>('[data-object-id]')?.dataset['objectId'];
    // Only objects that are not locked (themselves or through their layer) react to the pointer.
    const hit = interactive.find((object) => object.id === hitId);
    const { style } = useToolStore.getState();

    if (tool === 'eraser') {
      if (hit?.type === 'path') deleteObjects(doc.id, page.id, new Set([hit.id]));
      return;
    }
    if (tool === 'note') {
      makeCurrent();
      createNote(doc.id, page.id, { x: point.x - NOTE_SIZE / 2, y: point.y - NOTE_SIZE / 2 });
      event.preventDefault();
      return;
    }
    if (tool === 'text') {
      makeCurrent();
      if (hit?.type === 'text') {
        selectObjects(doc.id, [hit.id]);
        startTextEditing(doc.id, page.id, hit);
      } else {
        const created = createTextObject(point, style);
        addObject(doc.id, page.id, created);
        startTextEditing(doc.id, page.id, created);
      }
      // Do not let the browser move focus away from the editor that is about to appear.
      event.preventDefault();
      return;
    }

    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.stopPropagation();

    if (tool === 'select') {
      const single = selectedIds.length === 1 ? objects.find((object) => object.id === selectedIds[0]) : undefined;
      if (handle && single) {
        drag.current =
          handle === 'rotate'
            ? { kind: 'rotate', original: single }
            : { kind: 'resize', handle: handle as ResizeHandle, original: single };
        return;
      }
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      makeCurrent();
      if (hit) {
        // A grouped object stands for its whole group.
        const group = expandToGroups(interactive, [hit.id]);
        let ids = selectedIds;
        if (additive)
          ids = ids.includes(hit.id) ? ids.filter((id) => !group.includes(id)) : [...new Set([...ids, ...group])];
        else if (!ids.includes(hit.id)) ids = group;
        selectObjects(doc.id, ids);
        const moving = new Set(ids);
        drag.current = {
          kind: 'move',
          start: point,
          originals: interactive.filter((object) => moving.has(object.id)),
          moved: false,
        };
      } else {
        if (!additive) selectObjects(doc.id, []);
        drag.current = { kind: 'marquee', start: point };
      }
      return;
    }

    if (tool === 'link') {
      drag.current = { kind: 'link', start: point };
    } else if (SHAPE_TOOLS.has(tool)) {
      drag.current = { kind: 'create', shape: tool as ShapeKind, start: point };
    } else if (tool === 'draw' || tool === 'highlight') {
      drag.current = { kind: 'draw', points: [point] };
      setPreview({ kind: 'draw', points: [point] });
    } else {
      activateTool('select');
    }
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    const state = drag.current;
    if (!state) return;
    const point = toPage(event);
    const { style } = useToolStore.getState();

    if (state.kind === 'move') {
      const dx = point.x - state.start.x;
      const dy = point.y - state.start.y;
      // A click must not turn into a tiny accidental move.
      if (!state.moved && Math.hypot(dx, dy) * scale < CLICK_TOLERANCE) return;
      state.moved = true;
      setDraft(new Map(state.originals.map((object) => [object.id, translate(object, dx, dy)])));
    } else if (state.kind === 'resize') {
      const { original } = state;
      const linear = original.type === 'shape' && (original.shape === 'line' || original.shape === 'arrow');
      // Images keep their proportions unless Shift is held; for everything else Shift constrains.
      const keepAspect = (original.type === 'image') !== event.shiftKey;
      const minimum = linear ? 0 : MIN_OBJECT_SIZE;
      const resized = resizeObject(original, state.handle, point, {
        keepAspect,
        minWidth: minimum,
        minHeight: minimum,
      });
      setDraft(new Map([[original.id, resized.type === 'text' ? fitTextHeight(resized) : resized]]));
    } else if (state.kind === 'rotate') {
      const rotation = rotationTowards(state.original, point, event.shiftKey);
      setDraft(new Map([[state.original.id, { ...state.original, rotation }]]));
    } else if (state.kind === 'marquee' || state.kind === 'link') {
      setPreview({ kind: 'marquee', box: boxFromPoints(state.start, point) });
    } else if (state.kind === 'create') {
      setPreview({ kind: 'shape', object: createShapeObject(state.shape, state.start, point, style) });
    } else {
      const last = state.points.at(-1);
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.5) return;
      state.points.push(point);
      setPreview({ kind: 'draw', points: [...state.points] });
    }
  };

  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>): void => {
    const state = drag.current;
    if (!state) return;
    const point = toPage(event);
    const { style } = useToolStore.getState();

    if (state.kind === 'move' || state.kind === 'resize' || state.kind === 'rotate') {
      if (draft) replaceObjects(doc.id, page.id, [...draft.values()]);
    } else if (state.kind === 'marquee') {
      const box = boxFromPoints(state.start, point);
      if (box.width * scale > CLICK_TOLERANCE || box.height * scale > CLICK_TOLERANCE) {
        const touched = interactive
          .filter((object) => boxesIntersect(boundsOf(object), box))
          .map((object) => object.id);
        const inside = expandToGroups(interactive, touched);
        selectObjects(doc.id, event.shiftKey ? [...new Set([...selectedIds, ...inside])] : inside);
      }
    } else if (state.kind === 'link') {
      makeCurrent();
      const dragged = boxFromPoints(state.start, point);
      // A click makes a link area of a convenient default size.
      const box =
        dragged.width * scale < CLICK_TOLERANCE && dragged.height * scale < CLICK_TOLERANCE
          ? { x: state.start.x, y: state.start.y - 10, width: 120, height: 20 }
          : {
              ...dragged,
              width: Math.max(dragged.width, MIN_OBJECT_SIZE),
              height: Math.max(dragged.height, MIN_OBJECT_SIZE),
            };
      createLink(doc.id, page.id, box);
    } else if (state.kind === 'create') {
      makeCurrent();
      addObject(doc.id, page.id, createShapeObject(state.shape, state.start, point, style));
      activateTool('select');
    } else {
      const path = createPathObject(state.points, style, tool === 'highlight');
      if (path) {
        makeCurrent();
        addObject(doc.id, page.id, path);
        // Keep drawing: a selection frame around every stroke would get in the way.
        selectObjects(doc.id, []);
      }
    }
    finish();
  };

  const editing = editingId ? objects.find((object) => object.id === editingId) : undefined;
  const shown = (object: EditorObject): EditorObject => draft?.get(object.id) ?? object;
  // What is painted: visible layers bottom to top, with layer opacity applied.
  const painted = resolveObjects(layers, draft ? objects.map(shown) : objects);
  const selected =
    selectedIds.length > 0 ? objects.filter((object) => selectedIds.includes(object.id)).map(shown) : NO_OBJECTS;
  const single = selected.length === 1 && tool === 'select' && !editing ? selected[0] : undefined;
  const handleSize = 8 * unit;

  return (
    <svg
      ref={svgRef}
      className="page-overlay"
      viewBox={`0 0 ${display.width} ${display.height}`}
      data-tool={tool}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={finish}
      onDoubleClick={(event) => {
        if (tool !== 'select') return;
        // While a press is captured by the overlay, the browser reports the overlay itself as
        // the target of the double click, so the object is looked up under the pointer.
        const under = document.elementFromPoint?.(event.clientX, event.clientY) ?? null;
        const target = under?.closest<SVGElement>('[data-object-id]') ?? (event.target as Element).closest<SVGElement>('[data-object-id]');
        const hitId = target?.dataset['objectId'];
        const hit = interactive.find((object) => object.id === hitId);
        if (hit?.type === 'text') startTextEditing(doc.id, page.id, hit);
        else if (hit?.type === 'link') void followLink(hit);
        else if (hit?.type === 'note') {
          useSettingsStore.getState().update({ layout: { leftCollapsed: false, leftTab: 'comments' } });
          useUiStore.getState().setNoteFocus(hit.id);
        }
      }}
    >
      <g transform={pageRotationTransform(page.box, page.rotation)}>
        {painted.map((entry) => (
          <ObjectView
            key={entry.object.id}
            object={entry.object}
            editing={entry.object.id === editing?.id}
            locked={!entry.interactive}
          />
        ))}

        {searchHits.map((hit, index) =>
          hit.pageId === page.id ? (
            <rect
              key={index}
              className="search-hit"
              data-active={hit === activeHit || undefined}
              x={hit.x}
              y={hit.y}
              width={hit.width}
              height={hit.height}
            />
          ) : null,
        )}

        {tool in TEXT_TOOL_MODES && (
          <TextRunsLayer document={doc} page={page} unit={unit} mode={TEXT_TOOL_MODES[tool]!} toPage={toPage} />
        )}

        {preview?.kind === 'shape' && <ObjectView object={preview.object} />}
        {preview?.kind === 'draw' && (
          <polyline
            className="page-overlay__stroke"
            points={preview.points.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke={
              tool === 'highlight' ? useToolStore.getState().style.highlightColor : useToolStore.getState().style.stroke
            }
            strokeWidth={
              tool === 'highlight'
                ? Math.max(12, useToolStore.getState().style.strokeWidth * 6)
                : useToolStore.getState().style.strokeWidth
            }
            strokeOpacity={tool === 'highlight' ? 0.4 : 1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {preview?.kind === 'marquee' && (
          <rect
            className="page-overlay__marquee"
            {...preview.box}
            strokeWidth={unit}
            strokeDasharray={`${4 * unit} ${3 * unit}`}
          />
        )}

        {tool === 'select' &&
          selected.map((object) => (
            <g key={object.id} className="selection" transform={objectTransform(object)} data-selection-for={object.id}>
              <rect className="selection__outline" width={object.width} height={object.height} strokeWidth={unit} />
              {single && object.type !== 'note' && (
                <>
                  {object.type !== 'link' && (
                    <>
                      <line
                        className="selection__outline"
                        x1={object.width / 2}
                        y1={0}
                        x2={object.width / 2}
                        y2={-22 * unit}
                        strokeWidth={unit}
                      />
                      <circle
                        className="selection__handle selection__handle--rotate"
                        cx={object.width / 2}
                        cy={-22 * unit}
                        r={handleSize * 0.6}
                        strokeWidth={unit}
                        data-handle="rotate"
                      />
                    </>
                  )}
                  {(object.type === 'text' ? TEXT_HANDLES : ALL_HANDLES).map((handle) => {
                    const fx = handle.includes('w') ? 0 : handle.includes('e') ? 1 : 0.5;
                    const fy = handle.includes('n') ? 0 : handle.includes('s') ? 1 : 0.5;
                    return (
                      <rect
                        key={handle}
                        className="selection__handle"
                        x={object.width * fx - handleSize / 2}
                        y={object.height * fy - handleSize / 2}
                        width={handleSize}
                        height={handleSize}
                        strokeWidth={unit}
                        data-handle={handle}
                        data-cursor={handle}
                      />
                    );
                  })}
                </>
              )}
            </g>
          ))}

        {editing?.type === 'text' && (
          <TextEditor key={editing.id} object={editing} unit={unit} text={editingState?.text ?? editing.text} />
        )}
      </g>
    </svg>
  );
}
