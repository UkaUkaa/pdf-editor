/** A font family installed on the computer, as offered in the font list. */
export interface SystemFontFamily {
  /** Family name as stored in the font files, e.g. "Times New Roman". */
  family: string;
  /** Which of the four styles the family really has; the others fall back to the closest one. */
  regular: boolean;
  bold: boolean;
  italic: boolean;
  boldItalic: boolean;
  /** Ascender height as a fraction of the font size. */
  ascent: number;
}

export interface FontFaceRequest {
  family: string;
  bold: boolean;
  italic: boolean;
}

export const MAX_FONT_FAMILY_LENGTH = 100;
