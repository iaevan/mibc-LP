const socials = [
  { name: 'Facebook', href: 'https://www.facebook.com/NSUMIBC', path: 'M14 21v-8h3l.5-4H14V7c0-1.2.4-2 2-2h2V1.4A25 25 0 0 0 15 1c-3 0-5 1.8-5 5v3H7v4h3v8z' },
  { name: 'Instagram', href: 'https://www.instagram.com/nsumibc/' },
  { name: 'LinkedIn', href: 'https://www.linkedin.com/company/nsumibc/', path: 'M5 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM3 9h4v12H3V9Zm6 0h4v1.6c.7-1.2 1.8-1.9 3.5-1.9 3.2 0 4.5 2 4.5 5.4V21h-4v-6.1c0-1.7-.5-2.6-1.8-2.6-1.5 0-2.2 1-2.2 2.6V21H9V9Z' },
];

export function SocialLinks() {
  return <nav className="footer-socials" aria-label="Follow MIBC">{socials.map(social =>
    <a key={social.name} href={social.href} aria-label={`MIBC on ${social.name} (opens in a new tab)`} title={social.name} target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">{social.path ? <path d={social.path} /> : <><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="17.5" cy="6.5" r="1.2" /></>}</svg>
    </a>
  )}</nav>;
}
