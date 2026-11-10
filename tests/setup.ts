import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// PDF.js needs a real browser (workers, canvas). Unit tests replace the loader
// with a fake through `setPdfLoader`; real rendering is covered by the e2e suite.
vi.mock('@renderer/engine/pdf/pdfjsSource', () => ({
  loadPdf: vi.fn(async () => {
    throw new Error('PDF.js is not available in unit tests');
  }),
  MAX_CANVAS_PIXELS: 4096 * 4096,
}));

// The real exporter (pdf-lib) is tested on real files in buildPdf.test.ts and end to end.
// Component tests get a transparent stand-in whose output lists the exported pages.
vi.mock('@renderer/engine/export/exportService', () => ({
  exportPages: vi.fn(
    async (content: {
      pages: Array<{ id: string; source: unknown; rotation: number }>;
      objects?: Record<string, unknown[]>;
      layers?: Record<string, unknown[]>;
      bookmarks?: unknown[];
      attachments?: Array<{ name: string }>;
      recognised?: Record<string, Array<{ text: string }>>;
      protection?: { password: string } | null;
    }) =>
      new TextEncoder().encode(
        `%PDF-fake${JSON.stringify({
          pages: content.pages.map((page) => [page.source, page.rotation]),
          // Content per exported page, in page order.
          objects: content.pages.map((page) => content.objects?.[page.id] ?? []),
          layers: content.pages.map((page) => content.layers?.[page.id] ?? []),
          recognised: content.pages.map((page) => (content.recognised?.[page.id] ?? []).map((line) => line.text)),
          bookmarks: content.bookmarks ?? [],
          attachments: (content.attachments ?? []).map((attachment) => attachment.name),
          // Present only for protected output, so unprotected exports look as before.
          ...(content.protection ? { password: content.protection.password } : {}),
        })}`,
      ),
  ),
}));

if (typeof HTMLCanvasElement !== 'undefined') {
  // jsdom has no canvas implementation; drawing is a no-op in component tests.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});
