/** Plain data read from a source PDF. Kept free of browser types so it can be used anywhere. */

/** An annotation of the source file that the editor can take over as an editable object. */
export type SourceAnnotation = {
  /** Object number of the annotation in the file, used to avoid writing it twice. */
  objectNumber: number;
  /** Rectangle in page space (points, origin top-left, y down). */
  x: number;
  y: number;
  width: number;
  height: number;
} & (
  | { kind: 'note'; text: string; author: string; modified: string; color: string | null; inReplyTo: number | null }
  | { kind: 'link'; url: string | null; pageIndex: number | null }
);

export interface SourceAttachment {
  name: string;
  data: Uint8Array;
}
