import { cn } from "@repo/ui";

/** Standard page container used by every app page. */
export function PageContainer({ children, className, wide = false }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 py-6 sm:px-6 lg:px-8", wide ? "max-w-[1600px]" : "max-w-[1280px]", className)}>{children}</div>;
}
