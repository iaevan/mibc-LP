import { ClubProgram } from '@/components/club-program';
import type { Metadata } from 'next';
import { Shell, ApplyLink, FAQ, Journey } from '@/components/common';
import { Asterisk, Arrow } from '@/components/icons';
import { disciplines } from '@/lib/content';
export const metadata: Metadata = { title: 'Studio: Bring your kind of different' };
export default function StudioPage() {
  return <Shell theme="studio" active={3}>
    <section className="studio-hero section-pad" data-motion><div className="studio-hero-meta"><span>MIBC RECRUITMENT</span><span>THE NEXT CHAPTER IS A COLLECTIVE ONE.</span></div><h1>BRING YOUR<br /><span>KIND OF</span><br /><em>DIFFERENT.</em></h1><div className="studio-artifacts" aria-hidden="true"><div className="studio-ticket"><Asterisk /><span>GOOD IDEAS<br />DON’T GROW<br />ALONE.</span><div className="ticket-perf" /><span className="ticket-caption">ADMIT ONE CURIOUS MIND</span></div><div className="studio-note">a little<br />out of the<br /><em>ordinary.</em><span>MIBC ↗</span></div><span className="studio-orbit-type">MAKE SOMETHING MATTER.</span></div><div className="studio-hero-bottom"><p>Big thinkers. Quiet makers. People people.<br />There’s no single way to belong at MIBC.</p><ApplyLink>Find your kind of people</ApplyLink></div></section>
    <ClubProgram />
    <div className="studio-ticker" data-motion aria-hidden="true"><span>IDEAS INTO ACTION <Asterisk /> STRANGERS INTO TEAMMATES <Asterisk /> CURIOSITY INTO POSSIBILITY <Asterisk /></span></div>
    <section className="studio-about section-pad" id="about"><div className="studio-about-mark"><Asterisk /><span>THINK.<br />MAKE.<br />CONNECT.</span></div><div data-reveal><h2>Less sitting on<br />a good idea.<br /><em>More making it happen.</em></h2><p>Welcome to the Marketing and International Business Club of North South University. A place to test your thinking, try a different role, and turn the things you care about into things you can create together.</p><p>You don’t need a perfectly polished pitch.<br />Just the curiosity to start.</p></div></section>
    <section className="studio-disciplines section-pad" id="possibilities"><div className="studio-section-title"><h2>WHAT’S<br /><em>YOUR THING?</em></h2><p>Start with what sounds like you.<br />Leave room for a surprise.</p></div><div className="studio-disciplines-list">{disciplines.map(item => <details key={item.title}><summary><span>{item.title}</span><Arrow diagonal /></summary><div><p>{item.text}</p><span>{item.tags}</span></div></details>)}</div></section>
    <section className="studio-manifesto section-pad"><h2><em>YOU.</em><Asterisk /></h2><p>You’re the only thing missing.<br />Your questions. Your perspective. That one idea you keep coming back to.</p></section>
    <section className="studio-journey section-pad"><h2>GO ON.<br /><em>MAKE A MOVE.</em></h2><Journey /></section>
    <FAQ title="Good questions. Glad you asked." />
    <section className="studio-final section-pad" id="join"><div><h2>LET’S MAKE<br /><em>SOMETHING<br />MATTER.</em></h2><Asterisk /></div><div className="studio-final-bottom"><p>Your next chapter doesn’t<br />have to look like everyone else’s.</p><div><ApplyLink>Put your name in the mix</ApplyLink><span className="form-note">Takes you to Google Forms</span></div></div></section>
  </Shell>;
}
