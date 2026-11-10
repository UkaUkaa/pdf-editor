export interface DecodedImage {
  /** PNG or JPEG bytes that can be embedded into a PDF unchanged. */
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  bitmap: ImageBitmap;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

/**
 * Decodes an image file with the browser's own decoders. PNG and JPEG keep
 * their original bytes (no quality loss); other formats are converted to PNG,
 * because those are the two raster formats a PDF can embed.
 */
export async function decodeImage(fileName: string, data: Uint8Array): Promise<DecodedImage> {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) throw new Error(`Unsupported image type: ${extension}`);

  const bitmap = await createImageBitmap(new Blob([data.slice()], { type: mime }));
  if (mime === 'image/png' || mime === 'image/jpeg') return { bytes: data, mime, bitmap };

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('Cannot convert the image to PNG');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', bitmap };
}
