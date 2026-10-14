"use client";

/**
 * Last-resort fallback when the root layout itself fails. It replaces the whole document, so it
 * can't use the app's stylesheet or fonts — styles are inline and follow the OS colour scheme.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <head>
        <title>Something went wrong</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          :root{color-scheme:light dark;--bg:#f6f1e9;--fg:#2a241d;--sub:#6f655a;--btn:#2a241d;--btnfg:#fffdf9}
          @media (prefers-color-scheme:dark){:root{--bg:#17140f;--fg:#f1ebe2;--sub:#a99f92;--btn:#f1ebe2;--btnfg:#17140f}}
          body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;padding:24px}
          h1{font-size:26px;margin:0 0 8px;letter-spacing:-.02em}p{color:var(--sub);margin:0 auto;max-width:420px}
          button{margin-top:28px;background:var(--btn);color:var(--btnfg);border:0;border-radius:10px;padding:11px 20px;font:inherit;font-weight:600;cursor:pointer}
          code{display:block;margin-top:12px;font-size:12px;color:var(--sub)}
        `}</style>
      </head>
      <body>
        <main>
          <h1>Something went wrong</h1>
          <p>Reachly hit an unexpected error while loading. Please try again in a moment.</p>
          {error.digest ? <code>Reference: {error.digest}</code> : null}
          <button type="button" onClick={() => retry()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
