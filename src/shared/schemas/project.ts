import { z } from 'zod';
import type { Attachment, Bookmark, PageModel, RecognisedText } from '../types/document';
import { MAX_FONT_FAMILY_LENGTH } from '../types/fonts';
import { LAYER_TYPES, type PageLayers } from '../types/layers';
import { FONT_FAMILIES, SHAPE_KINDS, TEXT_ALIGNMENTS, type PageObjects } from '../types/objects';

/**
 * Schema of the `.pdfproject` format. Project files are untrusted input like
 * any other file: everything read from one is validated against this schema
 * before it reaches the application.
 */

export const PROJECT_FORMAT = 'pdfproject';
/** Version written by this build. Older versions are migrated on open; newer ones are refused. */
export const PROJECT_VERSION = 1;

/** Ids become file names inside the archive, so their alphabet is restricted. */
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const finite = z.number().finite();
const coordinate = finite.min(-1e6).max(1e6);
const size = finite.min(0).max(1e6);
const opacity = finite.min(0).max(1);
/** Colours are parsed leniently wherever they are used, so only the length is limited here. */
const color = z.string().max(32);
const text = z.string().max(200_000);
const shortText = z.string().max(2_000);

export const manifestSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  version: z.number().int().min(1),
  appVersion: z.string().max(40),
  /** ISO 8601 timestamp of the save. */
  savedAt: z.string().max(40),
  name: z.string().max(300),
});
export type ProjectManifest = z.infer<typeof manifestSchema>;

const box = z.object({ x: coordinate, y: coordinate, width: size, height: size });

const pageSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pdf'), sourceId: id, pageIndex: z.number().int().min(0).max(100_000) }),
  z.object({ kind: z.literal('image'), assetId: id }),
  z.object({ kind: z.literal('blank') }),
]);

const page = z.object({
  id,
  source: pageSource,
  box,
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});

const objectBase = {
  id,
  layerId: id,
  groupId: id.optional(),
  locked: z.boolean().optional(),
  x: coordinate,
  y: coordinate,
  width: size,
  height: size,
  rotation: finite.min(-360).max(360),
  opacity,
};

const editorObject = z.discriminatedUnion('type', [
  z.object({
    ...objectBase,
    type: z.literal('text'),
    text,
    // A bundled family or the name of an installed one; the font file itself is not stored.
    fontFamily: z.string().min(1).max(MAX_FONT_FAMILY_LENGTH),
    fontSize: finite.min(1).max(2_000),
    bold: z.boolean(),
    italic: z.boolean(),
    color,
    align: z.enum(TEXT_ALIGNMENTS),
    lineHeight: finite.min(0.5).max(5),
    background: color.nullable(),
    replacesOriginal: z.boolean(),
  }),
  z.object({ ...objectBase, type: z.literal('image'), assetId: id, flipX: z.boolean(), flipY: z.boolean() }),
  z.object({
    ...objectBase,
    type: z.literal('shape'),
    shape: z.enum(SHAPE_KINDS),
    stroke: color.nullable(),
    strokeWidth: finite.min(0).max(1_000),
    fill: color.nullable(),
    dashed: z.boolean(),
    flipped: z.boolean(),
  }),
  z.object({
    ...objectBase,
    type: z.literal('path'),
    points: z.array(finite.min(-100).max(100)).max(400_000),
    stroke: color,
    strokeWidth: finite.min(0).max(1_000),
    highlighter: z.boolean(),
  }),
  z.object({
    ...objectBase,
    type: z.literal('note'),
    text,
    author: shortText,
    createdAt: z.string().max(40),
    replies: z.array(z.object({ id, text, author: shortText, createdAt: z.string().max(40) })).max(1_000),
    color,
    sourceAnnotation: z.string().max(20).optional(),
  }),
  z.object({
    ...objectBase,
    type: z.literal('link'),
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('url'), url: z.string().max(2_048) }),
      z.object({ kind: z.literal('page'), pageId: id }),
    ]),
    sourceAnnotation: z.string().max(20).optional(),
  }),
]);

const layer = z.object({
  id,
  name: z.string().max(200),
  type: z.enum(LAYER_TYPES),
  visible: z.boolean(),
  locked: z.boolean(),
  opacity,
});

type BookmarkInput = { id: string; title: string; pageId: string | null; children: BookmarkInput[] };
const bookmark: z.ZodType<BookmarkInput> = z.lazy(() =>
  z.object({ id, title: z.string().max(1_000), pageId: id.nullable(), children: z.array(bookmark).max(5_000) }),
);

const recognisedLine = z.object({
  text: z.string().max(10_000),
  x: coordinate,
  baseline: coordinate,
  angle: finite.min(-360).max(360),
  width: size,
  fontSize: finite.min(0).max(2_000),
  fontFamily: z.enum(FONT_FAMILIES),
});

export const projectModelSchema = z.object({
  pages: z.array(page).min(1).max(20_000),
  objects: z.record(id, z.array(editorObject).max(50_000)),
  layers: z.record(id, z.array(layer).max(1_000)),
  bookmarks: z.array(bookmark).max(5_000),
  attachments: z.array(z.object({ id, name: z.string().max(500), size: z.number().int().min(0), resourceId: id })).max(1_000),
  recognised: z.record(id, z.array(recognisedLine).max(100_000)),
  /** Source PDFs stored in the archive, with the annotations taken over from each page. */
  sources: z.array(z.object({ id, takenAnnotations: z.record(z.string().regex(/^\d{1,6}$/), z.array(z.number().int().min(0)).max(100_000)) })).max(1_000),
  /** Image assets stored in the archive. */
  assets: z.array(z.object({ id, mime: z.enum(['image/png', 'image/jpeg']) })).max(20_000),
});

/** The editable state of a document as stored in a project file. */
export interface ProjectModel {
  pages: PageModel[];
  objects: PageObjects;
  layers: PageLayers;
  bookmarks: Bookmark[];
  attachments: Attachment[];
  recognised: RecognisedText;
  sources: Array<{ id: string; takenAnnotations: Record<string, number[]> }>;
  assets: Array<{ id: string; mime: 'image/png' | 'image/jpeg' }>;
}

export type ProjectErrorCode = 'notProject' | 'corruptProject' | 'newerVersion' | 'tooLarge';

export class ProjectError extends Error {
  constructor(
    readonly code: ProjectErrorCode,
    cause?: unknown,
  ) {
    super(`Cannot read project: ${code}`, { cause });
    this.name = 'ProjectError';
  }
}

type Migration = (model: unknown) => unknown;
/**
 * Migrations from each older format version to the next one, keyed by the
 * version they start from. There are none yet: version 1 is the first format.
 */
export const MIGRATIONS: Record<number, Migration> = {};

/** Brings the model of an older project up to the current version and validates the result. */
export function migrateProjectModel(model: unknown, fromVersion: number, migrations: Record<number, Migration> = MIGRATIONS): ProjectModel {
  if (fromVersion > PROJECT_VERSION) throw new ProjectError('newerVersion');
  let current = model;
  for (let version = fromVersion; version < PROJECT_VERSION; version += 1) {
    const migrate = migrations[version];
    if (!migrate) throw new ProjectError('corruptProject');
    current = migrate(current);
  }
  const parsed = projectModelSchema.safeParse(current);
  if (!parsed.success) throw new ProjectError('corruptProject', parsed.error);
  return parsed.data as ProjectModel;
}
