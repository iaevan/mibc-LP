'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

const logos = [
  { name: 'MarXcellence', file: 'marxcellence' },
  { name: 'Innovade', file: 'innovade' },
  { name: 'Amelior', file: 'amelior' },
  { name: 'Intra-Ignite', file: 'intra-ignite' },
];

export function EventLogos() {
  const root = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  return <section ref={root} className={`event-logo-section section-pad${paused || !visible ? ' marquee-paused' : ''}`} aria-label="Our four event logos">
    <p className="logo-eyebrow">The events. The possibilities.</p>
    <div className="logo-marquees">{[logos, [logos[2], logos[3], logos[0], logos[1]]].map((row, rowIndex) =>
      <div className={`logo-marquee row-${rowIndex}`} key={rowIndex} aria-hidden={rowIndex === 1 ? true : undefined}>
        <div className="logo-marquee-track">{[0, 1].map(copy => <div className="logo-marquee-group" key={copy} aria-hidden={copy === 1 ? true : undefined}>
          {row.map(logo => <div className="marquee-logo" key={logo.file}><Image src={`/images/events/${logo.file}.webp`} alt={`${logo.name} logo`} width={1100} height={500} sizes="(max-width: 760px) 160px, 240px" /></div>)}
        </div>)}</div>
      </div>
    )}</div>
    <div className="marquee-controls"><button type="button" className="logo-pause" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? 'Play animation' : 'Pause animation'}</button></div>
  </section>;
}
