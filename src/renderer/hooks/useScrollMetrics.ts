import { useLayoutEffect, useState, type RefObject } from 'react';

export interface ScrollMetrics {
  scrollTop: number;
  width: number;
  height: number;
}

const EMPTY: ScrollMetrics = { scrollTop: 0, width: 0, height: 0 };

/**
 * Tracks the scroll offset and client size of a scroll container. Scroll
 * events are coalesced to one state update per animation frame.
 */
export function useScrollMetrics(ref: RefObject<HTMLElement | null>): ScrollMetrics {
  const [metrics, setMetrics] = useState<ScrollMetrics>(EMPTY);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const read = (): void =>
      setMetrics((previous) => {
        const next = { scrollTop: element.scrollTop, width: element.clientWidth, height: element.clientHeight };
        return previous.scrollTop === next.scrollTop && previous.width === next.width && previous.height === next.height
          ? previous
          : next;
      });

    let frame = 0;
    const onScroll = (): void => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        read();
      });
    };

    read();
    element.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    observer?.observe(element);
    return () => {
      element.removeEventListener('scroll', onScroll);
      observer?.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [ref]);

  return metrics;
}
