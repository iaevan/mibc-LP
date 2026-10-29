import Image from 'next/image';

export default function NotFound() {
  return <main className="not-found-page">
    <a href="/" aria-label="MIBC home"><Image src="/images/mibc-logo.webp" alt="NSU MIBC" width={112} height={80} /></a>
    <h1>This page couldn’t<br />be <em>found.</em></h1>
    <p>The link may have changed. Our recruitment information is all on the home page.</p>
    <a className="button" href="/">Back to home</a>
  </main>;
}
