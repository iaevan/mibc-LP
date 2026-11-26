import type { Metadata } from "next";
import { CampaignAdmin } from "@/components/campaigns/admin";
export const metadata: Metadata = {
  title: "Email Campaign Admin",
  description: "Private MIBC campaign workspace.",
  robots: { index: false, follow: false },
  alternates: { canonical: null },
  openGraph: null,
  twitter: null,
};
export default function AdminPage() {
  return <CampaignAdmin />;
}
