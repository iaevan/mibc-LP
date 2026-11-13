import { HeroLinework } from '@/components/hero-linework';
import { ClubProgram } from '@/components/club-program';
import { EventLogos } from '@/components/event-logos';
import { Shell } from '@/components/common';
import { Asterisk } from '@/components/icons';


export default function SignalPage() {
  return <Shell theme="signal" showcase>
    <section className="signal-hero section-pad">
      <div className="signal-hero-copy">
        <div className="recruitment-edition"><span>NSU MIBC</span></div>
        <h1>Envision<br /><em>Beyond Borders</em></h1>
        <p>Marketing &amp; International Business Club<br />North South University</p>

        <div className="hero-actions"><a className="button" href="#annual-gatherings">Explore Our Events</a></div>
      </div>
      <div className="signal-art"><div className="signal-art-frame"><HeroLinework /><picture><source type="image/webp" srcSet="/images/crimson-knot-480.webp 480w, /images/crimson-knot-768.webp 768w, /images/crimson-knot.webp 1100w" sizes="(max-width: 523px) 88vw, (max-width: 760px) 460px, (max-width: 1600px) 42vw, 650px" /><img className="knot" src="/images/crimson-knot.webp" alt="A sculptural crimson ribbon forming three connected loops" width={1100} height={1100} fetchPriority="high" loading="eager" decoding="async" /></picture><svg className="art-cross" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg></div><span className="art-caption">Different minds.<br />Extraordinary possibilities.</span></div>
    </section>
    <ClubProgram showcase />
    <EventLogos />
    <section className="signal-manifesto club-motto section-pad" aria-labelledby="motto-title">
      <span className="motto-emblem" aria-hidden="true"><Asterisk /></span>
      <h2 id="motto-title" data-reveal>Marketing &amp;<br /><em>International Business Club</em></h2>
      <div className="motto-identity">
        <span className="motto-university">North South University</span>
        <p>NSU MIBC brings students together to explore marketing and international business through competitions, workshops, and conversations with industry professionals.</p>
      </div>
    </section>

  </Shell>;
}
