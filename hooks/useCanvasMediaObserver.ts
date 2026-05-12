import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

type CanvasMediaObserverParams = {
  enabled?: boolean;
  rootRef: RefObject<HTMLElement | null>;
  scanKey: string | number;
};

export const useCanvasMediaObserver = ({
  enabled = true,
  rootRef,
  scanKey,
}: CanvasMediaObserverParams) => {
  const observedRef = useRef<Set<Element>>(new Set());
  const scanTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    if (!enabled || typeof IntersectionObserver === 'undefined') {
      root.querySelectorAll('.media-offscreen').forEach((el) => {
        el.classList.remove('media-offscreen');
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle('media-offscreen', !entry.isIntersecting);
        });
      },
      {
        root,
        rootMargin: '360px',
        threshold: 0,
      },
    );

    const scan = () => {
      const nodeEls = root.querySelectorAll('.node-wrapper, .canvas-node');

      nodeEls.forEach((el) => {
        if (observedRef.current.has(el)) return;
        observer.observe(el);
        observedRef.current.add(el);
      });

      Array.from(observedRef.current).forEach((el) => {
        if (root.contains(el)) return;
        observer.unobserve(el);
        observedRef.current.delete(el);
      });
    };

    scanTimerRef.current = window.setTimeout(scan, 80);

    return () => {
      if (scanTimerRef.current !== null) {
        window.clearTimeout(scanTimerRef.current);
        scanTimerRef.current = null;
      }
      observedRef.current.forEach((el) => {
        el.classList.remove('media-offscreen');
        observer.unobserve(el);
      });
      observedRef.current.clear();
      observer.disconnect();
    };
  }, [enabled, rootRef, scanKey]);
};
