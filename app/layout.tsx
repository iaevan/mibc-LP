import type { Metadata, Viewport } from 'next';
import { SITE_URL, structuredData } from '@/lib/site';
import './globals.css';

const siteUrl = SITE_URL;
const socialTitle = 'NSU MIBC | Envision Beyond Borders';
const socialDescription = 'NSU MIBC is the Marketing & International Business Club at North South University. Explore MarXcellence, Innovade, Amelior, and Intra-Ignite.';
const socialImage = {
  url: '/og/nsu-mibc.jpg',
  secureUrl: `${siteUrl}/og/nsu-mibc.jpg`,
  width: 1200,
  height: 630,
  type: 'image/jpeg',
  alt: 'NSU MIBC: Envision Beyond Borders',
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'NSU MIBC | Marketing & International Business Club', template: '%s | NSU MIBC' },
  description: socialDescription,
  applicationName: 'NSU MIBC',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'NSU MIBC',
    url: '/',
    title: socialTitle,
    description: socialDescription,
    images: [socialImage],
  },
  twitter: {
    card: 'summary_large_image',
    title: socialTitle,
    description: socialDescription,
    images: [{ url: socialImage.url, alt: socialImage.alt }],
  },
  robots: { index: true, follow: true, 'max-image-preview': 'large' },
  icons: { icon: [{ url: '/favicon.png', sizes: '128x128', type: 'image/png' }], apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }] },
};
export const viewport: Viewport = { themeColor: '#23090f', width: 'device-width', initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head><link rel="preload" href="/fonts/dm-sans.woff2" as="font" type="font/woff2" crossOrigin="anonymous" /><link rel="preload" href="/fonts/instrument-serif-italic.woff2" as="font" type="font/woff2" crossOrigin="anonymous" /></head><body><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />{children}</body></html>;
}
