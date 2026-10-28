'use client';

import { useEffect } from 'react';

// Native scrolling remains authoritative. Work is scheduled only while a
// visible scene moves, then the frame loop sleeps until the next input.
export function PageMotion() {
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let cleanup = () => {};
    function setup() {
      cleanup();
      if (preference.matches) return;
      const scenes = Array.from(document.querySelectorAll<HTMLElement>('[data-motion]'));
      const visible = new Set<HTMLElement>();
      const stack = document.querySelector<HTMLElement>('.track-spread');
      const cards = Array.from(document.querySelectorAll<HTMLElement>('.track-sheet'));
      const events = Array.from(document.querySelectorAll<HTMLElement>('.season-event'));
      const sizeStack = () => {
        const fits = innerWidth <= 760 && innerHeight >= 650 && cards.every(card => card.offsetHeight < innerHeight - 150);
        stack?.classList.toggle('mobile-stack', fits);
      };
      sizeStack();
      const sizes = new ResizeObserver(sizeStack);
      cards.forEach(card => sizes.observe(card));
      const animations = new Set<Animation>();
      const values = new Map<HTMLElement, number>();
      let frame = 0;
      let previous = 0;
      const tick = (now: number) => {
        frame = 0;
        const blend = 1 - Math.exp(-Math.min(now - previous || 16, 50) / 85);
        previous = now;
        let unsettled = false;
        const measurements = Array.from(visible, el => ({ el, rect: el.getBoundingClientRect() }));
        // Read all positions before writing transforms. A card scales back
        // only when the following card reaches the top of the stack.
        const cover = stack?.classList.contains('mobile-stack') && visible.has(stack)
          ? cards.map((card, i) => {
            const next = cards[i + 1];
            return { card, value: next ? Math.max(0, Math.min(1, (innerHeight * .68 - next.getBoundingClientRect().top) / (innerHeight * .68 - 90))) : 0 };
          }) : [];
        const arrivals = innerWidth <= 760 ? events.map(event => ({ event, value: Math.max(0, Math.min(1, (innerHeight * .9 - event.getBoundingClientRect().top) / (innerHeight * .5))) })) : [];
        cover.forEach(({ card, value }) => card.style.setProperty('--cover', value.toFixed(4)));
        arrivals.forEach(({ event, value }) => event.style.setProperty('--arrival', value.toFixed(4)));
        for (const { el, rect } of measurements) {
          const target = Math.max(0, Math.min(1, (innerHeight - rect.top) / (innerHeight + rect.height)));
          const old = values.get(el) ?? target;
          const value = old + (target - old) * blend;
          values.set(el, value);
          el.style.setProperty('--scene', value.toFixed(5));
          unsettled ||= Math.abs(target - value) > .0001;
        }
        if (unsettled) frame = requestAnimationFrame(tick);
      };
      const wake = () => { if (!frame && !document.hidden) { previous = performance.now(); frame = requestAnimationFrame(tick); } };
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting) visible.add(el); else visible.delete(el);
        }
        wake();
      }, { rootMargin: '80px' });
      scenes.forEach(el => observer.observe(el));
      const reveals = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const stamp = el.classList.contains('small-seal');
          const animation = el.animate(stamp ? [
            { transform: 'scale(1.65) rotate(-24deg)', opacity: 0 },
            { transform: 'scale(.94) rotate(3deg)', opacity: 1, offset: .7 },
            { transform: 'scale(1) rotate(0deg)', opacity: 1 },
          ] : [{ opacity: .45, transform: 'translateY(22px)' }, { opacity: 1, transform: 'none' }],
          { duration: stamp ? 650 : 600, easing: 'cubic-bezier(.16,1,.3,1)' });
          animations.add(animation);
          animation.onfinish = () => animations.delete(animation);
          reveals.unobserve(el);
        }
      }, { threshold: .3 });
      document.querySelectorAll('[data-reveal], .small-seal').forEach(el => reveals.observe(el));
      window.addEventListener('scroll', wake, { passive: true });
      window.addEventListener('resize', wake, { passive: true });
      window.addEventListener('resize', sizeStack, { passive: true });
      document.addEventListener('visibilitychange', wake);
      cleanup = () => {
        cancelAnimationFrame(frame); observer.disconnect(); reveals.disconnect(); sizes.disconnect();
        window.removeEventListener('resize', sizeStack);
        stack?.classList.remove('mobile-stack');
        cards.forEach(card => card.style.removeProperty('--cover'));
        events.forEach(event => event.style.removeProperty('--arrival'));
        animations.forEach(animation => animation.cancel());
        window.removeEventListener('scroll', wake); window.removeEventListener('resize', wake);
        document.removeEventListener('visibilitychange', wake);
        scenes.forEach(el => el.style.removeProperty('--scene'));
      };
    }
    setup(); preference.addEventListener('change', setup);
    return () => { cleanup(); preference.removeEventListener('change', setup); };
  }, []);
  return null;
}
