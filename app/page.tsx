import { ClubProgram } from '@/components/club-program';
import { EventLogos } from '@/components/event-logos';
import { Shell, ApplyLink, FinalCTA } from '@/components/common';
import { Geometry, Arrow, Asterisk } from '@/components/icons';


export default function SignalPage() {
  return <Shell theme="signal" active={0}>
    <section className="signal-hero section-pad" data-motion>
      <div className="signal-hero-copy">
        <div className="recruitment-edition"><span>MIBC Recruitment</span><strong>10.0</strong><span>The 10th edition</span></div>
        <h1>Redefine Your<br /><em>Dimensions</em></h1>

        <div className="hero-actions"><ApplyLink>REGISTER NOW</ApplyLink></div>
      </div>
      <div className="signal-art"><div className="signal-art-frame"><Geometry /><picture><source type="image/webp" srcSet="/images/crimson-knot-480.webp 480w, /images/crimson-knot-768.webp 768w, /images/crimson-knot.webp 1100w" sizes="(max-width: 523px) 88vw, (max-width: 760px) 460px, (max-width: 1600px) 42vw, 650px" /><img className="knot" src="/images/crimson-knot.webp" alt="A sculptural crimson ribbon forming three connected loops" width={1100} height={1100} fetchPriority="high" loading="eager" decoding="async" /></picture><span className="art-cross" aria-hidden="true">+</span></div><span className="art-caption">Different minds.<br />Extraordinary possibilities.</span></div>
      <div className="hero-baseline"><span>Made of ambition.<br />Built by people like you.</span><a href="#weekly-tracks">Discover what’s next <Arrow /></a><span>North South University<br />Marketing &amp; International Business Club</span></div>
    </section>
    <ClubProgram />
    <EventLogos />
    <section className="signal-manifesto club-motto section-pad" aria-labelledby="motto-title"><span className="motto-emblem" aria-hidden="true"><Asterisk /></span><h2 id="motto-title" data-reveal>Envision<br /><em>Beyond Borders.</em></h2><div className="motto-identity"><p>Marketing &amp; International<br className="motto-name-break" /> Business Club</p><span className="motto-university">North South University</span></div></section>

    <FinalCTA title={<>Redefine Your<br /><em>Dimensions</em></>}>Be part of MIBC Recruitment 10.0. Bring your ambition. Find your people.</FinalCTA>
  </Shell>;
}
