import { ClubProgram } from '@/components/club-program';
import type { Metadata } from 'next';
import { Shell, ApplyLink, FAQ, Journey, FinalCTA } from '@/components/common';
import { Globe } from '@/components/globe';
import { Arrow, Asterisk } from '@/components/icons';
import { disciplines } from '@/lib/content';
export const metadata: Metadata = { title: 'Orbit — A bigger world starts here' };
export default function OrbitPage() {
  return <Shell theme="orbit" active={2}>
    <section className="orbit-hero section-pad"><div className="orbit-heading"><h1>Your campus.<br /><em>A bigger world.</em></h1><div><p>New perspectives. Shared ambition.<br />A whole world of possibilities,<br />starting with MIBC.</p><ApplyLink>Step into your next orbit</ApplyLink></div></div><Globe /><div className="orbit-hero-bottom"><span>Rooted at North South University.<br />Curious about everything beyond it.</span><a href="#about">Make a connection <Arrow /></a></div></section>
    <ClubProgram />
    <section className="orbit-about section-pad" id="about"><Asterisk /><div data-reveal><h2>Business is global.<br /><em>Connection is personal.</em></h2><p className="lead">Marketing connects ideas to people. International business connects people to possibilities. MIBC brings those conversations to your university life.</p><p>Find the thinkers who challenge your perspective, the makers who bring ideas to life, and the teammates who make the journey worth it.</p></div></section>
    <section className="orbit-paths section-pad" id="possibilities"><div className="orbit-section-heading"><h2>Choose a direction.<br /><em>Keep an open mind.</em></h2><span>Your interests are a starting point,<br />not a boundary.</span></div><div className="orbit-path-list">{disciplines.map(item => <article key={item.title}><span className="orbit-node" /><h3>{item.title}</h3><p>{item.text}</p><Arrow diagonal /></article>)}</div></section>
    <section className="orbit-journey section-pad"><h2>The distance between<br />“what if” and <em>“I’m in.”</em></h2><Journey /></section>
    <FAQ title="Before you make the connection." />
    <FinalCTA title={<>A bigger world.<br /><em>With you in it.</em></>}>Bring your perspective. Find your people.<br />See where the connection takes you.</FinalCTA>
  </Shell>;
}
