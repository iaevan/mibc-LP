import type { CSSProperties } from 'react';

export function Arrow({ diagonal = false, className = '' }: { diagonal?: boolean; className?: string }) {
  return <svg aria-hidden="true" className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={diagonal ? 'M5 19 19 5M5 5h14v14' : 'M4 12h16m-7-7 7 7-7 7'} /></svg>;
}

export function Asterisk({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <svg aria-hidden="true" className={`asterisk ${className}`} style={style} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="10"><path d="M50 0v100M6.7 25l86.6 50M6.7 75l86.6-50" /></svg>;
}

export function Geometry({ className = '' }: { className?: string }) {
  const points = Array.from({ length: 12 }, (_, i) => { const angle = i * Math.PI / 6 - Math.PI / 2; return `${300 + Math.cos(angle) * 270},${300 + Math.sin(angle) * 270}`; });
  return <svg className={`geometry ${className}`} viewBox="0 0 600 600" fill="none" aria-hidden="true"><g stroke="currentColor" strokeWidth=".7"><polygon points={points.join(' ')} />{points.map((p, i) => <g key={p}><path d={`M${p}L${points[(i + 5) % 12]}L${points[(i + 8) % 12]}`} /><path d={`M${p}L300,300`} /></g>)}<circle cx="300" cy="300" r="200" /><circle cx="300" cy="300" r="270" /></g></svg>;
}
