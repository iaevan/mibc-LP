'use client';

import { useEffect, useRef } from 'react';
import { Geometry } from './icons';

export function HeroLinework() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let visible = false;
    const sync = () => element.classList.toggle('is-running', visible && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(element);
    document.addEventListener('visibilitychange', sync);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  return <div ref={ref} className="hero-linework" aria-hidden="true"><Geometry /></div>;
}
