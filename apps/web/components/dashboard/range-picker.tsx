"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@repo/ui";

const OPTIONS = [
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
  { value: "365", label: "12m" },
] as const;

/** Date-range control synced to the `?days=` search param so views are linkable. */
export function RangePicker({ defaultDays = 30 }: { defaultDays?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("days") ?? String(defaultDays);
  return (
    <SegmentedControl
      size="sm"
      value={OPTIONS.some((option) => option.value === current) ? current : String(defaultDays)}
      options={OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
      onValueChange={(value) => {
        const next = new URLSearchParams(params);
        next.set("days", value);
        router.push(`${pathname}?${next.toString()}`, { scroll: false });
      }}
    />
  );
}
