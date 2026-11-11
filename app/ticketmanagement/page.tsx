import type { Metadata, Viewport } from 'next';
import { TicketApp } from '@/components/ticketing/ticket-app';

export const metadata: Metadata = {
  title: 'Ticket desk',
  description: 'Organizer check-in for MIBC events.',
  robots: { index: false, follow: false, nocache: true },
  alternates: { canonical: null },
  openGraph: null,
  twitter: null,
  appleWebApp: { capable: true, title: 'MIBC Tickets', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  themeColor: '#1a070c',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function TicketManagementPage() {
  return <TicketApp />;
}
