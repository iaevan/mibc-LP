'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Arrow } from './icons';
const topics = [
  { name: 'Ideas', title: 'Ideas travel further together.', text: 'A different perspective can change everything. Explore branding, creative strategy, and the stories that move people.' },
  { name: 'People', title: 'Your world gets bigger with people.', text: 'Meet curious minds across campus. Learn to listen, collaborate, and turn a shared interest into something you build together.' },
  { name: 'Possibilities', title: 'See what you haven’t tried yet.', text: 'From the first spark to the final experience, discover the skills and confidence that come from stepping into something new.' },
];
export function Globe() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const yaw = useRef(0.3);
  const scrollAngle = useRef(0);
  const motion = useRef(0);
  const drag = useRef<{ x: number; lastX: number; time: number; velocity: number; origin: number } | null>(null);
  const [topic, setTopic] = useState(0);
  const [ready, setReady] = useState(false);
  const render = useCallback(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const size = el.clientWidth;
    if (!size) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (el.width !== size * dpr) { el.width = size * dpr; el.height = size * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const center = size / 2;
    const r = size * 0.395;
    const sin = Math.sin(yaw.current + scrollAngle.current), cos = Math.cos(yaw.current + scrollAngle.current);
    const project = (x: number, y: number, z: number) => { const rx = x * cos + z * sin; const rz = z * cos - x * sin; return [center + rx * r, center + (y * .96 - rz * (.25 + Math.sin(scrollAngle.current) * .18)) * r, rz]; };
    ctx.lineWidth = .6;
    for (let meridian = 0; meridian < 12; meridian++) {
      ctx.beginPath();
      for (let step = 0; step <= 90; step++) { const a = step / 90 * Math.PI * 2; const b = meridian / 12 * Math.PI; const p = project(Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)); if (!step) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
      ctx.strokeStyle = 'rgba(217,126,135,.13)'; ctx.stroke();
    }
    for (let lat = -3; lat <= 3; lat++) {
      ctx.beginPath(); const y = lat / 4; const ring = Math.sqrt(1 - y * y);
      for (let step = 0; step <= 90; step++) { const a = step / 90 * Math.PI * 2; const p = project(Math.cos(a) * ring, y, Math.sin(a) * ring); if (!step) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
      ctx.strokeStyle = 'rgba(217,126,135,.13)'; ctx.stroke();
    }
    const count = 950;
    for (let i = 0; i < count; i++) {
      const y = 1 - i / (count - 1) * 2; const radial = Math.sqrt(1 - y * y); const theta = 2.399963229728653 * i;
      const p = project(Math.cos(theta) * radial, y, Math.sin(theta) * radial);
      const opacity = .13 + (p[2] + 1) / 2 * .7;
      ctx.fillStyle = `rgba(240,${Math.round(107 + (p[2] + 1) * 30)},${Math.round(114 + (p[2] + 1) * 25)},${opacity})`;
      ctx.beginPath(); ctx.arc(p[0], p[1], (p[2] > .4 ? 1.65 : 1.1) * size / 560, 0, Math.PI * 2); ctx.fill();
    }
    // A travelling connection traces an inclined orbit as the visitor scrolls.
    ctx.beginPath();
    const phase = scrollAngle.current * .7;
    for (let i = 0; i <= 100; i++) {
      const a = phase + i / 100 * Math.PI * 1.35;
      const p = project(Math.cos(a) * 1.13, Math.sin(a) * .48, Math.sin(a) * 1.02);
      if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    }
    ctx.strokeStyle = 'rgba(255,224,199,.45)'; ctx.lineWidth = 1; ctx.stroke();
    const traveller = project(Math.cos(phase) * 1.13, Math.sin(phase) * .48, Math.sin(phase) * 1.02);
    ctx.beginPath(); ctx.arc(traveller[0], traveller[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff2dd'; ctx.fill();
    const nodes = [[.75, -.33, .57], [-.62, -.49, .61], [.22, .7, .68]];
    nodes.forEach((node, i) => { const p = project(...node as [number, number, number]); if (p[2] < -.2) return; ctx.beginPath(); ctx.arc(p[0], p[1], i === topic ? 6 : 3.5, 0, Math.PI * 2); ctx.fillStyle = i === topic ? '#fff2dd' : '#f16570'; ctx.fill(); if (i === topic) { ctx.beginPath(); ctx.arc(p[0], p[1], 13, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,242,221,.55)'; ctx.stroke(); } });
  }, [topic]);
  useEffect(() => { setReady(true); const resize = new ResizeObserver(render); if (canvas.current) resize.observe(canvas.current); render(); return () => { resize.disconnect(); cancelAnimationFrame(motion.current); }; }, [render]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false, frame = 0, previous = 0;
    const tick = (now: number) => {
      frame = 0;
      if (!visible || document.hidden || preference.matches) return;
      const rect = el.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, (innerHeight - rect.top) / (innerHeight + rect.height)));
      const target = (progress - .42) * Math.PI * 3;
      const dt = Math.min(now - previous || 16, 50); previous = now;
      scrollAngle.current += (target - scrollAngle.current) * (1 - Math.exp(-dt / 95));
      render();
      if (Math.abs(target - scrollAngle.current) > .001) frame = requestAnimationFrame(tick);
    };
    const wake = () => { if (!frame && visible && !preference.matches && !document.hidden) { previous = performance.now(); frame = requestAnimationFrame(tick); } };
    const reset = () => { if (preference.matches) { cancelAnimationFrame(frame); frame = 0; scrollAngle.current = 0; render(); } else wake(); };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; wake(); });
    observer.observe(el);
    window.addEventListener('scroll', wake, { passive: true });
    window.addEventListener('resize', wake, { passive: true });
    document.addEventListener('visibilitychange', wake);
    preference.addEventListener('change', reset);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('scroll', wake); window.removeEventListener('resize', wake); document.removeEventListener('visibilitychange', wake); preference.removeEventListener('change', reset); };
  }, [render]);
  function release() {
    const current = drag.current; drag.current = null;
    if (!current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const initial = yaw.current; const target = initial + Math.max(-1.2, Math.min(1.2, current.velocity * .12));
    let velocity = current.velocity; let previous = performance.now();
    function frame(now: number) { const dt = Math.min((now - previous) / 1000, .032); previous = now; const acceleration = (target - yaw.current) * 100 - 20 * velocity; velocity += acceleration * dt; yaw.current += velocity * dt; render(); if (Math.abs(velocity) > .002 || Math.abs(target - yaw.current) > .002) motion.current = requestAnimationFrame(frame); }
    motion.current = requestAnimationFrame(frame);
  }
  return <div className="orbit-interactive"><div className="globe-wrap"><div className="globe-halo" aria-hidden="true" /><canvas ref={canvas} className={`globe-canvas ${ready ? 'is-ready' : ''}`} role="img" aria-label="An interactive geometric globe representing connected ideas. Drag horizontally or use the arrow buttons to rotate." onPointerDown={event => { cancelAnimationFrame(motion.current); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, lastX: event.clientX, time: performance.now(), velocity: 0, origin: yaw.current }; }} onPointerMove={event => { const current = drag.current; if (!current) return; const now = performance.now(); current.velocity = (event.clientX - current.lastX) * .008 / Math.max(.008, (now - current.time) / 1000); yaw.current = current.origin + (event.clientX - current.x) * .008; current.lastX = event.clientX; current.time = now; render(); }} onPointerUp={release} onPointerCancel={release} /><svg className="globe-fallback" aria-hidden="true" viewBox="0 0 500 500"><g fill="none" stroke="currentColor"><circle cx="250" cy="250" r="195" /><ellipse cx="250" cy="250" rx="95" ry="195" /><ellipse cx="250" cy="250" rx="155" ry="195" /><ellipse cx="250" cy="250" rx="195" ry="70" /><ellipse cx="250" cy="250" rx="195" ry="140" /></g></svg><span className="globe-label label-ideas">IDEAS</span><span className="globe-label label-people">PEOPLE</span><span className="globe-label label-possible">POSSIBILITIES</span><div className="globe-controls"><button aria-label="Rotate globe left" onClick={() => { yaw.current -= .35; render(); }}><Arrow /></button><span>Scroll to orbit · Drag to explore</span><button aria-label="Rotate globe right" onClick={() => { yaw.current += .35; render(); }}><Arrow /></button></div></div><div className="orbit-topic-bar"><div className="topic-buttons" role="group" aria-label="Explore what connects us">{topics.map((item, i) => <button key={item.name} aria-pressed={topic === i} onClick={() => setTopic(i)}>{item.name}</button>)}</div><div className="topic-copy" aria-live="polite"><h2>{topics[topic].title}</h2><p>{topics[topic].text}</p></div></div></div>;
}
