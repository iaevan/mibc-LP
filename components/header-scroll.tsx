'use client';

import { useEffect, useRef } from 'react';

export function HeaderScroll() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const target = marker.current;
    const header = target?.nextElementSibling;
    if (!target || !(header instanceof HTMLElement)) return;
    // A wrapped header must not occupy most of a magnified or short viewport.
    // Measure only on size changes, never on each scroll event.
    const updateSize = () => {
      const height = header.getBoundingClientRect().height;
      const unpinned = height > Math.min(144, innerHeight * .22);
      header.classList.toggle('is-unpinned', unpinned);
      document.documentElement.style.setProperty('--navigation-offset', unpinned ? '24px' : `${Math.ceil(height) + 16}px`);
    };
    const sizes = new ResizeObserver(updateSize);
    sizes.observe(header);
    window.addEventListener('resize', updateSize, { passive: true });
    updateSize();
    const observer = new IntersectionObserver(([entry]) => {
      header.classList.toggle('is-scrolled', !entry.isIntersecting);
    });
    observer.observe(target);
    return () => {
      observer.disconnect();
      sizes.disconnect();
      window.removeEventListener('resize', updateSize);
      header.classList.remove('is-unpinned');
      document.documentElement.style.removeProperty('--navigation-offset');
    };
  }, []);
  return <span ref={marker} className="header-scroll-marker" aria-hidden="true" />;
}
