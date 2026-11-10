import type { Layer } from '@shared/types/layers';
import {
  DEFAULT_NOTE_COLOR,
  NOTE_SIZE,
  type EditorObject,
  type LinkObject,
  type NoteObject,
} from '@shared/types/objects';
import { safeExternalUrl } from '@shared/utils/externalUrl';
import { createLayer } from '../layers/layerOperations';
import type { SourceAnnotation } from './sourceTypes';

/** Parses a PDF date string (`D:YYYYMMDDHHmmSS+HH'mm'`) into an ISO timestamp. */
export function parsePdfDate(value: string, fallback = new Date(0).toISOString()): string {
  const match = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*([Zz+-])?(\d{2})?'?(\d{2})?/.exec(value.trim());
  if (!match) return fallback;
  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00', sign, offsetHours = '00', offsetMinutes = '00'] = match;
  const zone = sign === '+' || sign === '-' ? `${sign}${offsetHours}:${offsetMinutes}` : 'Z';
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

export interface ImportedAnnotations {
  objects: EditorObject[];
  /** The layer the objects were put on; `null` when there is nothing to import. */
  layer: Layer | null;
  /** Object numbers of the source annotations now represented by `objects`. */
  taken: number[];
}

/**
 * Turns the comments and links of a source page into editable objects on an
 * annotation layer. Replies are attached to the note they answer.
 */
export function importAnnotations(
  annotations: readonly SourceAnnotation[],
  pageIdAt: (sourcePageIndex: number) => string | null,
  makeId: () => string,
  layerName: string,
): ImportedAnnotations {
  const layerId = makeId();
  const objects: EditorObject[] = [];
  const taken: number[] = [];
  const notes = new Map<number, NoteObject>();
  const base = { layerId, rotation: 0, opacity: 1 };

  for (const annotation of annotations) {
    if (annotation.kind !== 'note' || annotation.inReplyTo !== null) continue;
    const note: NoteObject = {
      ...base,
      id: makeId(),
      type: 'note',
      // The icon keeps a fixed size wherever the annotation's own rectangle put it.
      x: annotation.x,
      y: annotation.y,
      width: NOTE_SIZE,
      height: NOTE_SIZE,
      text: annotation.text,
      author: annotation.author,
      createdAt: parsePdfDate(annotation.modified),
      replies: [],
      color: annotation.color ?? DEFAULT_NOTE_COLOR,
      sourceAnnotation: String(annotation.objectNumber),
    };
    notes.set(annotation.objectNumber, note);
    objects.push(note);
    taken.push(annotation.objectNumber);
  }

  for (const annotation of annotations) {
    if (annotation.kind === 'note' && annotation.inReplyTo !== null) {
      // A reply whose note is missing stays in the file as it is.
      const parent = notes.get(annotation.inReplyTo);
      if (!parent) continue;
      parent.replies.push({
        id: makeId(),
        text: annotation.text,
        author: annotation.author,
        createdAt: parsePdfDate(annotation.modified),
      });
      taken.push(annotation.objectNumber);
    } else if (annotation.kind === 'link') {
      const url = annotation.url ? safeExternalUrl(annotation.url) : null;
      const pageId = annotation.pageIndex !== null ? pageIdAt(annotation.pageIndex) : null;
      const target: LinkObject['target'] | null = url ? { kind: 'url', url } : pageId ? { kind: 'page', pageId } : null;
      if (!target || annotation.width <= 0 || annotation.height <= 0) continue;
      objects.push({
        ...base,
        id: makeId(),
        type: 'link',
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
        target,
        sourceAnnotation: String(annotation.objectNumber),
      });
      taken.push(annotation.objectNumber);
    }
  }

  return { objects, layer: objects.length > 0 ? { ...createLayer(layerId, layerName, 'annotation') } : null, taken };
}
