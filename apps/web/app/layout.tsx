import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { brand } from "@repo/config";
import { Providers } from "@/components/providers";
import "./globals.css";

// Clean, Apple-like type: Apple devices use their own SF Pro (system font, see globals.css);
// everyone else gets Inter, the closest open font. One family for body and headings.
const sans = Inter({ subsets: ["latin"], variable: "--font-sans-face", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face", display: "swap" });

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: brand.description,
  applicationName: brand.name,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3eee4" },
    { media: "(prefers-color-scheme: dark)", color: "#14110d" },
  ],
};

/**
 * Development only: some browser extensions tag every element (e.g. `bis_skin_checked`) before React
 * hydrates, and others throw errors from their own scripts. Neither is our code, but both fill the dev
 * error overlay. Strip the attributes as they appear and swallow errors raised inside extensions.
 */
const EXTENSION_NOISE_GUARD = `(function () {
  var attrs = ["bis_skin_checked", "bis_register", "__processed"];
  function clean(el) { for (var i = 0; i < attrs.length; i++) if (el.hasAttribute && el.hasAttribute(attrs[i])) el.removeAttribute(attrs[i]); }
  function sweep() { var all = document.querySelectorAll("[" + attrs.join("],[") + "]"); for (var i = 0; i < all.length; i++) clean(all[i]); }
  new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === "attributes") clean(r.target);
      else for (var j = 0; j < r.addedNodes.length; j++) if (r.addedNodes[j].nodeType === 1) { clean(r.addedNodes[j]); sweep(); break; }
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: attrs });
  sweep();
  function fromExtension(stack) { return typeof stack === "string" && /(chrome|moz|safari-web)-extension:\\/\\//.test(stack); }
  window.addEventListener("error", function (e) {
    if (fromExtension(e.filename) || fromExtension(e.error && e.error.stack)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    if (fromExtension(e.reason && e.reason.stack)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      {process.env.NODE_ENV !== "production" ? (
        <head>
          <script dangerouslySetInnerHTML={{ __html: EXTENSION_NOISE_GUARD }} />
        </head>
      ) : null}
      {/* Browser extensions (e.g. download managers, password managers) add attributes to <body> before React loads. */}
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
