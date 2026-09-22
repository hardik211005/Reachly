import { PageHero } from "@/components/page-hero";
import { SettingsNav } from "@/components/settings/kit";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-6">
      <PageHero title="Settings" highlight="Settings" description="Your workspace, profile, business details, team and the guardrails that keep outreach compliant." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <SettingsNav />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5">{children}</div>
      </div>
    </div>
  );
}
