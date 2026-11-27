import type { Metadata, Viewport } from 'next';
import { CaseViewer } from '@/components/cases/case-viewer';

export const metadata: Metadata = {
  title: 'Case',
  description: 'Case document shared by NSU MIBC.',
  robots: { index: false, follow: false, nocache: true },
  alternates: { canonical: null },
  openGraph: null,
  twitter: null,
};

export const viewport: Viewport = { themeColor: '#1a070c', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function CasePage() {
  return <CaseViewer />;
}
