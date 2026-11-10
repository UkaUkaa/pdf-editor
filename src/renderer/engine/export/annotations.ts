import { PDFArray, PDFDict, PDFHexString, PDFName, PDFRef, PDFString, type PDFDocument, type PDFPage } from '@cantoo/pdf-lib';
import type { PdfBox } from '@shared/types/document';
import type { EditorObject, LinkObject, NoteObject } from '@shared/types/objects';
import { safeExternalUrl } from '@shared/utils/externalUrl';
import { parseColor } from './drawObjects';

/** Formats a timestamp as a PDF date string (UTC). */
export function pdfDate(iso: string): string {
  const date = new Date(iso);
  const valid = Number.isNaN(date.getTime()) ? new Date(0) : date;
  const part = (value: number, length = 2): string => String(value).padStart(length, '0');
  return (
    `D:${part(valid.getUTCFullYear(), 4)}${part(valid.getUTCMonth() + 1)}${part(valid.getUTCDate())}` +
    `${part(valid.getUTCHours())}${part(valid.getUTCMinutes())}${part(valid.getUTCSeconds())}Z`
  );
}

/** Rectangle of an object in PDF user space: [left, bottom, right, top]. */
function annotationRect(object: EditorObject, box: PdfBox): number[] {
  const top = box.y + box.height;
  return [box.x + object.x, top - (object.y + object.height), box.x + object.x + object.width, top - object.y];
}

function writeNote(document: PDFDocument, page: PDFPage, note: NoteObject, box: PdfBox): void {
  const { context } = document;
  const color = parseColor(note.color);
  const base = {
    Type: 'Annot',
    Subtype: 'Text',
    Rect: annotationRect(note, box),
    // Print flag: the note is part of the document, not a screen-only hint.
    F: 4,
    C: [color.red, color.green, color.blue],
  };
  const parent = context.register(
    context.obj({
      ...base,
      Name: 'Comment',
      Contents: PDFHexString.fromText(note.text),
      T: PDFHexString.fromText(note.author),
      M: PDFString.of(pdfDate(note.createdAt)),
      NM: PDFString.of(note.id),
    }),
  );
  page.node.addAnnot(parent);
  for (const reply of note.replies) {
    // A reply is an annotation of its own that refers to the note it answers.
    const ref = context.register(
      context.obj({
        ...base,
        Name: 'Comment',
        Contents: PDFHexString.fromText(reply.text),
        T: PDFHexString.fromText(reply.author),
        M: PDFString.of(pdfDate(reply.createdAt)),
        NM: PDFString.of(reply.id),
        IRT: parent,
      }),
    );
    page.node.addAnnot(ref);
  }
}

function writeLink(document: PDFDocument, page: PDFPage, link: LinkObject, box: PdfBox, pageRefs: ReadonlyMap<string, PDFRef>): void {
  const { context } = document;
  const base = { Type: 'Annot', Subtype: 'Link', Rect: annotationRect(link, box), Border: [0, 0, 0], F: 4 };
  if (link.target.kind === 'url') {
    // Only plain web and mail addresses are ever written as link targets.
    const url = safeExternalUrl(link.target.url);
    if (!url) return;
    page.node.addAnnot(context.register(context.obj({ ...base, A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) } })));
    return;
  }
  const target = pageRefs.get(link.target.pageId);
  if (target) page.node.addAnnot(context.register(context.obj({ ...base, Dest: [target, PDFName.of('Fit')] })));
}

export interface AnnotatedPage {
  pageId: string;
  page: PDFPage;
  box: PdfBox;
  objects: readonly EditorObject[];
}

/**
 * Writes notes and links as PDF annotations. Runs after all pages exist,
 * because a link may point at a page that comes later in the document.
 */
export function writeAnnotations(document: PDFDocument, pages: readonly AnnotatedPage[]): void {
  const pageRefs = new Map(pages.map((entry) => [entry.pageId, entry.page.ref]));
  for (const { page, box, objects } of pages) {
    for (const object of objects) {
      if (object.type === 'note') writeNote(document, page, object, box);
      else if (object.type === 'link') writeLink(document, page, object, box, pageRefs);
    }
  }
}

/**
 * Removes from a source page the annotations that were turned into editable
 * objects when the file was opened (identified by object number), together
 * with their pop-up windows. Without this they would be written twice.
 */
export function stripAnnotations(page: PDFPage, objectNumbers: ReadonlySet<number>): void {
  const annotations = page.node.Annots();
  if (!annotations || objectNumbers.size === 0) return;
  const kept: PDFRef[] = [];
  let removed = false;
  for (let index = 0; index < annotations.size(); index += 1) {
    const entry = annotations.get(index);
    if (!(entry instanceof PDFRef)) continue;
    let strip = objectNumbers.has(entry.objectNumber);
    if (!strip) {
      const dict = annotations.lookupMaybe(index, PDFDict);
      const parent = dict?.get(PDFName.of('Parent'));
      const subtype = dict?.get(PDFName.of('Subtype'));
      strip = subtype === PDFName.of('Popup') && parent instanceof PDFRef && objectNumbers.has(parent.objectNumber);
    }
    if (strip) removed = true;
    else kept.push(entry);
  }
  if (!removed) return;
  const next = PDFArray.withContext(page.doc.context);
  for (const ref of kept) next.push(ref);
  page.node.set(PDFName.of('Annots'), next);
}
