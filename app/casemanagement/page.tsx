import type { Metadata, Viewport } from 'next';
import { CaseAdmin } from '@/components/cases/case-admin';

export const metadata: Metadata = {
  title: 'Case desk',
  description: 'Organizer uploads for MIBC case files.',
  robots: { index: false, follow: false, nocache: true },
  alternates: { canonical: null },
  openGraph: null,
  twitter: null,
};

export const viewport: Viewport = { themeColor: '#1a070c', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function CaseManagementPage() {
  return <CaseAdmin />;
}
