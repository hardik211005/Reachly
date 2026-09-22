import type { Metadata } from "next";
import { ApiKeysSettings } from "@/components/settings/api-keys-settings";

export const metadata: Metadata = { title: "API keys" };

export default function ApiKeysPage() {
  return <ApiKeysSettings />;
}
