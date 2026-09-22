import { Footer } from "@/components/marketing/footer";
import { MarketingNav } from "@/components/marketing/nav";
import { SiteSearchProvider } from "@/components/marketing/site-search";

/** Public website: navigation with site search, the page, and the footer. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <SiteSearchProvider>
      <div className="flex min-h-dvh flex-col overflow-x-clip bg-background">
        <a href="#main" className="sr-only z-[60] rounded-md bg-foreground px-3 py-2 text-sm text-background focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
          Skip to content
        </a>
        <MarketingNav />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
      </div>
    </SiteSearchProvider>
  );
}
