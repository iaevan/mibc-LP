'use client';

import { useEffect } from 'react';

export function SectionNavigation() {
  useEffect(() => {
    const cleanAddress = () => {
      if (location.hash) history.replaceState(history.state, '', location.pathname + location.search);
    };
    // Keep old shared section links usable, then clean the address bar.
    if (location.hash) {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      target?.scrollIntoView({ behavior: 'instant', block: 'start' });
      cleanAddress();
    }
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
      if (!link || link.target || link.hasAttribute('download')) return;
      const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      if (!target) return;
      event.preventDefault();
      cleanAddress();
      const temporaryFocus = !target.hasAttribute('tabindex');
      if (temporaryFocus) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      if (temporaryFocus) target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
      target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    };
    document.addEventListener('click', navigate);
    return () => document.removeEventListener('click', navigate);
  }, []);
  return null;
}
