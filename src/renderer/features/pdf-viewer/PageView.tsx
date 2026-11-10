import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PageModel } from '@shared/types/document';
import { RenderCancelledError } from '../../engine/pdf/types';
import { renderPage } from '../../engine/rendering/pageRenderer';

interface PageViewProps {
  documentId: string;
  page: PageModel;
  /** Device pixels per PDF point for the rendered bitmap. */
  pixelsPerPoint: number;
}

/**
 * Canvas showing one rendered page. While a new resolution is being rendered
 * the previous image stays on screen (stretched by CSS), so zooming never flashes.
 */
export function PageView({ documentId, page, pixelsPerPoint }: PageViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'pending' | 'ready' | 'error'>('pending');

  const blank = page.source.kind === 'blank';

  useEffect(() => {
    // A blank page is just white paper: there is nothing to rasterise.
    if (blank) return;
    let active = true;
    const job = renderPage(documentId, page, pixelsPerPoint);
    job.promise.then(
      (bitmap) => {
        const canvas = canvasRef.current;
        if (!active || !canvas) return;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        setStatus('ready');
      },
      (error: unknown) => {
        if (!active || error instanceof RenderCancelledError) return;
        console.error('Failed to render a page', error);
        setStatus('error');
      },
    );
    return () => {
      active = false;
      job.cancel();
    };
  }, [blank, documentId, page, pixelsPerPoint]);

  return (
    <>
      <canvas ref={canvasRef} className="page-canvas" data-status={blank ? 'ready' : status} aria-hidden />
      {status === 'error' && <p className="page-canvas__error">{t('viewer.renderError')}</p>}
    </>
  );
}
