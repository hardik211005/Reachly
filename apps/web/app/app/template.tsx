import { PageTransition } from "@repo/ui";

/** Each app page enters with a short fade and rise; templates re-mount on navigation. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
