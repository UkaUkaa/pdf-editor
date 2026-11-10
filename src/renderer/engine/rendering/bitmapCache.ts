export interface CachedBitmap {
  width: number;
  height: number;
}

/**
 * Least-recently-used cache of rendered pages, bounded by total pixel count
 * (each pixel costs four bytes) rather than by entry count, because one page
 * at high zoom can outweigh a hundred thumbnails.
 */
export class BitmapCache<T extends CachedBitmap> {
  private readonly entries = new Map<string, T>();
  private pixels = 0;

  constructor(private readonly maxPixels: number) {}

  get(key: string): T | undefined {
    const bitmap = this.entries.get(key);
    if (bitmap) {
      // Re-insert to mark as most recently used.
      this.entries.delete(key);
      this.entries.set(key, bitmap);
    }
    return bitmap;
  }

  set(key: string, bitmap: T): void {
    this.delete(key);
    this.entries.set(key, bitmap);
    this.pixels += bitmap.width * bitmap.height;
    for (const oldest of this.entries.keys()) {
      if (this.pixels <= this.maxPixels || this.entries.size === 1) break;
      this.delete(oldest);
    }
  }

  /** Drops every entry whose key starts with the prefix (e.g. all pages of one document). */
  deleteByPrefix(prefix: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get totalPixels(): number {
    return this.pixels;
  }

  private delete(key: string): void {
    const bitmap = this.entries.get(key);
    if (!bitmap) return;
    // Bitmaps are not closed here: a consumer may still be drawing one it was just handed.
    this.pixels -= bitmap.width * bitmap.height;
    this.entries.delete(key);
  }
}
