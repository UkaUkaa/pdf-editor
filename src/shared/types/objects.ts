/**
 * Editable objects placed on top of a page.
 *
 * Geometry is stored in *page space*: PDF points, origin at the top-left corner
 * of the page's visible box before page rotation, x to the right, y down.
 * `x`/`y`/`width`/`height` describe the unrotated box; `rotation` turns the
 * object clockwise around the centre of that box.
 */

export const FONT_FAMILIES = ['sans', 'serif', 'mono'] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNMENTS)[number];

export const SHAPE_KINDS = ['rect', 'ellipse', 'line', 'arrow'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

interface ObjectBase {
  id: string;
  /** Layer of the page this object is on. */
  layerId: string;
  /** Objects sharing a group id are selected and moved together. */
  groupId?: string;
  /** A locked object cannot be selected or changed on the canvas. */
  locked?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise, around the centre of the box. */
  rotation: number;
  /** 0 (invisible) … 1 (opaque). */
  opacity: number;
}

export interface TextObject extends ObjectBase {
  type: 'text';
  text: string;
  fontFamily: FontFamily;
  /** Points. */
  fontSize: number;
  bold: boolean;
  italic: boolean;
  /** `#rrggbb`. */
  color: string;
  align: TextAlign;
  /** Multiple of the font size. */
  lineHeight: number;
  /** Fill behind the text, or `null` for none. */
  background: string | null;
  /**
   * True when the object covers and replaces text of the original page. The
   * original PDF text is still present underneath; this is an overlay, not a
   * native text edit.
   */
  replacesOriginal: boolean;
}

export interface ImageObject extends ObjectBase {
  type: 'image';
  assetId: string;
  flipX: boolean;
  flipY: boolean;
}

export interface ShapeObject extends ObjectBase {
  type: 'shape';
  shape: ShapeKind;
  stroke: string | null;
  strokeWidth: number;
  fill: string | null;
  dashed: boolean;
  /** Lines and arrows run from the top-left to the bottom-right corner, or bottom-left to top-right when flipped. */
  flipped: boolean;
}

export interface PathObject extends ObjectBase {
  type: 'path';
  /** Freehand stroke as x,y pairs normalised to the box (0…1), so resizing scales it. */
  points: number[];
  stroke: string;
  strokeWidth: number;
  /** Highlighter strokes are translucent and darken what is underneath. */
  highlighter: boolean;
}

export interface NoteReply {
  id: string;
  text: string;
  author: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** A sticky-note comment anchored to a point of the page. Saved as a PDF text annotation. */
export interface NoteObject extends ObjectBase {
  type: 'note';
  text: string;
  author: string;
  createdAt: string;
  replies: NoteReply[];
  color: string;
  /** Id of the annotation in the source PDF this note was read from, if any. */
  sourceAnnotation?: string;
}

export type LinkTarget = { kind: 'url'; url: string } | { kind: 'page'; pageId: string };

/** A clickable area. Saved as a PDF link annotation. */
export interface LinkObject extends ObjectBase {
  type: 'link';
  target: LinkTarget;
  sourceAnnotation?: string;
}

export type EditorObject = TextObject | ImageObject | ShapeObject | PathObject | NoteObject | LinkObject;

/** Size of the note icon on the page, in points. */
export const NOTE_SIZE = 20;
export const DEFAULT_NOTE_COLOR = '#ffd60a';
export type ObjectType = EditorObject['type'];

/** Objects of every page, keyed by page id; array order is the stacking order (last on top). */
export type PageObjects = Record<string, EditorObject[]>;

export const MIN_OBJECT_SIZE = 4;
export const TEXT_PADDING = 2;

/** Style applied to newly created objects; changed through the properties panel. */
export interface ToolStyle {
  stroke: string;
  strokeWidth: number;
  fill: string | null;
  fontFamily: FontFamily;
  fontSize: number;
  textColor: string;
  highlightColor: string;
}

export const DEFAULT_TOOL_STYLE: ToolStyle = {
  stroke: '#d92d20',
  strokeWidth: 2,
  fill: null,
  fontFamily: 'sans',
  fontSize: 14,
  textColor: '#111827',
  highlightColor: '#ffe14d',
};

export const TOOLS = [
  'select',
  'hand',
  'text',
  'editText',
  'rect',
  'ellipse',
  'line',
  'arrow',
  'draw',
  'highlight',
  'eraser',
  'note',
  'link',
  'underline',
  'strikethrough',
  'markText',
] as const;
export type Tool = (typeof TOOLS)[number];
