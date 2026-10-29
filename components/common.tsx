import Image from 'next/image';
import type { ReactNode } from 'react';
import { FORM_URL, faqs } from '@/lib/content';
import { Arrow, Asterisk } from './icons';
import { PageMotion } from './page-motion';
import { SocialLinks } from './social-links';
import { HeaderScroll } from './header-scroll';


export type Theme = 'signal' | 'edition' | 'orbit' | 'studio' | 'invitation';

export function ApplyLink({ children = 'REGISTER NOW', className = '', diagonal = true }: { children?: ReactNode; className?: string; diagonal?: boolean }) {
  return <a className={`button ${className}`} href={FORM_URL}>{children}</a>;
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <a className={`brand${compact ? ' brand-compact' : ''}`} href="#top" aria-label="MIBC, back to top"><span className="brand-logo"><Image src="/images/mibc-logo.png" alt="Marketing and International Business Club of North South University" width={6250} height={6250} priority={!compact} sizes="280px" /></span></a>;
}

export function Header({ theme }: { theme: Theme }) {
  return <header className={`site-header header-${theme}`}><Brand /><nav aria-label="Page navigation" className="page-links"><a href="#annual-gatherings">Our Events</a><a className="header-cta" href={FORM_URL}>REGISTER NOW</a></nav></header>;
}

export function Shell({ theme, children }: { theme: Theme; active?: number; children: ReactNode }) {
  return <div className={`site theme-${theme}`} id="top"><a className="skip-link" href="#main">Skip to content</a><HeaderScroll /><Header theme={theme} /><main id="main">{children}</main><footer className="site-footer"><Brand compact /><p>Marketing and International Business Club<br className="mobile-break" /> of North South University</p><SocialLinks /><a href="#top">Back to top <Arrow /></a></footer><PageMotion /></div>;
}

export function FAQ({ title = 'A little clarity, before you leap.' }: { title?: string }) {
  return <section className="faq-section section-pad" id="questions"><div className="faq-intro"><h2>{title}</h2><p>Curiosity looks good on you.<br />Here’s a little more to go on.</p></div><div className="faq-list">{faqs.map(faq => <details key={faq.question}><summary>{faq.question}<span className="plus" aria-hidden="true" /></summary><p>{faq.answer}</p></details>)}</div></section>;
}

export function Journey({ className = '' }: { className?: string }) {
  return <div className={`journey ${className}`}><article><span className="journey-step">01</span><h3>Introduce yourself.</h3><p>Tell us what sparks your curiosity, what you bring, and what you want to explore.</p></article><article><span className="journey-step">02</span><h3>Let’s get to know you.</h3><p>Look out for the club’s official recruitment updates and the next steps.</p></article><article><span className="journey-step">03</span><h3>Make your mark.</h3><p>Bring your ideas, find your people, and start a chapter that feels like you.</p></article></div>;
}

export function FinalCTA({ title, children, className = '' }: { title: ReactNode; children?: ReactNode; className?: string }) {
  return <section id="join" className={`final-cta section-pad ${className}`}><Asterisk /><h2>{title}</h2><p>{children || 'Your next chapter starts with a little curiosity. Bring yours to MIBC.'}</p><ApplyLink>REGISTER NOW</ApplyLink><span className="form-note">Takes you to Google Forms</span></section>;
}
