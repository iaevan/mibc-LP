import { ClubProgram } from '@/components/club-program';
import Image from 'next/image';
import { Shell, ApplyLink, FAQ, Journey, FinalCTA } from '@/components/common';
import { Geometry, Arrow, Asterisk } from '@/components/icons';
import { disciplines } from '@/lib/content';

export default function SignalPage() {
  return <Shell theme="signal" active={0}>
    <section className="signal-hero section-pad" data-motion>
      <div className="signal-hero-copy">
        <h1>Go beyond<br />the <em>ordinary.</em></h1>
        <p>A good idea changes things.<br />The right people change you.</p>
        <div className="hero-actions"><ApplyLink>Find your people</ApplyLink><span className="recruitment-status"><span /> MIBC Recruitment</span></div>
      </div>
      <div className="signal-art"><Geometry /><Image className="knot" src="/images/crimson-knot.webp" alt="A sculptural crimson ribbon forming three connected loops" width={1100} height={1100} priority sizes="(max-width: 700px) 88vw, 53vw" /><span className="art-caption">Different minds.<br />Extraordinary possibilities.</span><span className="art-cross" aria-hidden="true">+</span></div>
      <div className="hero-baseline"><span>Made of ambition.<br />Built by people like you.</span><a href="#about">Discover what’s next <Arrow /></a><span>North South University<br />Marketing &amp; International Business Club</span></div>
    </section>
    <ClubProgram />
    <section className="signal-about section-pad" id="about"><div className="section-rule"><Asterisk /></div><div className="signal-about-grid" data-reveal><h2>Some things are<br />better <em>built together.</em></h2><div><p className="lead">The idea you can’t stop thinking about. The skill you haven’t tried yet. The people you haven’t met.</p><p>MIBC is a place to bring them together. We’re the Marketing and International Business Club of North South University: a meeting point for curious minds, creative energy, and a world of business beyond the classroom.</p><a className="text-link" href="#possibilities">There’s a place for you here <Arrow diagonal /></a></div></div></section>
    <section className="signal-possibilities section-pad" id="possibilities"><h2>Find your thing.<br /><em>Then go further.</em></h2><div className="signal-discipline-list">{disciplines.map((item, i) => <article key={item.title}><span className="discipline-mark"><Asterisk style={{ transform: `rotate(${i * 15}deg)` }} /></span><h3>{item.title}</h3><p>{item.short}</p><Arrow diagonal /></article>)}</div></section>
    <section className="signal-manifesto section-pad" data-motion><h2><span className="manifesto-line">Bring the <em>“what if.”</em></span><span className="manifesto-line">We’ll bring the</span><span className="manifesto-line">“let’s find out.”</span></h2><div><span>Curiosity is your starting point.</span><Asterisk /></div></section>
    <section className="signal-journey section-pad"><h2>Every big thing<br />starts <em>somewhere.</em></h2><Journey /></section>
    <FAQ />
    <FinalCTA title={<>Your people.<br />Your <em>possibilities.</em></>} />
  </Shell>;
}
