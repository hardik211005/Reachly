import type { Metadata } from "next";
import { BusinessSettings } from "@/components/settings/business-settings";

export const metadata: Metadata = { title: "Business & services" };

export default function BusinessPage() {
  return <BusinessSettings />;
}
