import type { Metadata } from "next";
import { AuditLog } from "@/components/settings/audit-log";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditPage() {
  return <AuditLog />;
}
