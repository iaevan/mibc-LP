'use client';

import { useEffect, useRef } from 'react';

export function HeaderScroll() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const target = marker.current;
    const header = target?.nextElementSibling;
    if (!target || !header) return;
    const observer = new IntersectionObserver(([entry]) => {
      header.classList.toggle('is-scrolled', !entry.isIntersecting);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return <span ref={marker} className="header-scroll-marker" aria-hidden="true" />;
}
