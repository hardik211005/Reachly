import type { Metadata } from "next";
import { UseCasesIndexView } from "@/components/marketing/use-case-views";

export const metadata: Metadata = {
  title: "Use cases",
  description: "How agencies, B2B service firms, manufacturers and software teams find and win customers.",
};

export default function UseCasesPage() {
  return <UseCasesIndexView />;
}
