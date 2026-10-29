import { ClubProgram } from '@/components/club-program';
import type { Metadata } from 'next';
import { Shell, ApplyLink, FAQ, Journey } from '@/components/common';
import { EditionPoster } from '@/components/edition-poster';
import { Asterisk, Arrow } from '@/components/icons';
import { disciplines } from '@/lib/content';
export const metadata: Metadata = { title: 'Edition: A story worth being part of' };
export default function EditionPage() {
  return <Shell theme="edition" active={1}>
    <div className="edition-masthead"><span>The student perspective</span><span>THE MIBC EDITION</span><span>A new chapter begins</span></div>
    <section className="edition-hero section-pad" data-motion><div className="edition-hero-copy"><h1>Good stories<br />start with<br /><em>curious people.</em></h1><p>Consider this the beginning of yours.<br />Create, connect, and grow with the Marketing<br className="desktop-break" /> and International Business Club of NSU.</p><ApplyLink>Be part of the story</ApplyLink></div><div className="edition-cover"><EditionPoster /><p className="image-caption"><span>FIG. A: THE POSSIBILITIES ARE PERSONAL.</span><span>MIBC / RECRUITMENT</span></p></div></section>
    <ClubProgram />
    <section className="edition-intro section-pad" id="about"><span className="edition-side-note">A letter to the<br />not-quite-ordinary.</span><div data-reveal><h2>You’re more than<br />your <em>course outline.</em></h2><div className="edition-columns"><p>There’s a version of university life that happens between classes. Where a passing thought becomes a campaign. A conversation becomes a collaboration. And a room of strangers becomes your people.</p><p>That’s the space we want to make at MIBC. A club for thinking out loud, learning by doing, and seeing how far a shared idea can go. Bring your perspective. The story is better with you in it.</p></div></div></section>
    <section className="edition-contents section-pad" id="possibilities"><div className="edition-section-title"><h2>What will you<br /><em>make of it?</em></h2><p>A few places your<br />curiosity could take you.</p></div><div className="edition-contents-grid">{disciplines.map(item => <article key={item.title}><Asterisk /><h3>{item.title}</h3><span>{item.tags}</span><p>{item.text}</p></article>)}</div></section>
    <section className="edition-pullquote section-pad"><Asterisk /><h2>“The best part?<br />You don’t have to have<br />it all <em>figured out.</em>”</h2><p>You just have to be willing to begin.</p></section>
    <section className="edition-journey section-pad"><h2>A small beginning.<br /><em>An open-ended story.</em></h2><Journey /></section>
    <FAQ title="Before you turn the page." />
    <section className="edition-final section-pad" id="join"><div className="edition-final-top"><Asterisk /></div><h2>The next chapter<br />has <em>your name on it.</em></h2><div className="edition-final-bottom"><p>Bring your questions, your ideas,<br />and a little room for the unexpected.</p><div><ApplyLink>Write yourself into MIBC</ApplyLink><span className="form-note">Takes you to Google Forms</span></div></div><div className="edition-endmark">To be continued <Arrow /></div></section>
  </Shell>;
}
