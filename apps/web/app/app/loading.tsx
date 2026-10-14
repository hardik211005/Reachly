import { Skeleton } from "@repo/ui";
import { PageContainer } from "@/components/page";

/** Shown inside the shell while a page's server data loads. */
export default function AppLoading() {
  return (
    <PageContainer className="grid gap-5">
      <span className="sr-only" role="status">Loading</span>
      <Skeleton className="h-28 rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </PageContainer>
  );
}
