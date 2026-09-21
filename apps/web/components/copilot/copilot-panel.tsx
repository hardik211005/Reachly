"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowUp, Sparkles, Wrench } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle, Spinner, cn } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";

interface CopilotTurn {
  role: "user" | "assistant";
  content: string;
  tools?: Array<{ name: string; ok: boolean; error?: string }>;
  error?: boolean;
}

interface CopilotResponse {
  answer: string;
  tools: Array<{ name: string; ok: boolean; error?: string }>;
  provider: string;
  model: string;
}

const SUGGESTIONS = [
  "How are we doing this week?",
  "How much did we spend on AI this month?",
  "Show me leads in Delhi with score above 80",
  "Which campaign has the best reply rate?",
];

/** Renders plain text with line breaks and /app links made clickable. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, index) => (
        <p key={index} className={cn(line.startsWith("•") && "pl-3 -indent-3", index > 0 && "mt-1")}>
          {line.split(/(\/app\/[\w\-/?=&]+)/g).map((part, partIndex) =>
            part.startsWith("/app/") ? (
              <a key={partIndex} href={part} className="text-accent underline-offset-2 hover:underline">
                {part}
              </a>
            ) : (
              <React.Fragment key={partIndex}>{part}</React.Fragment>
            ),
          )}
        </p>
      ))}
    </>
  );
}

export function CopilotPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [turns, setTurns] = React.useState<CopilotTurn[]>([]);
  const [draft, setDraft] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const ask = useMutation({
    mutationFn: (history: CopilotTurn[]) =>
      api<CopilotResponse>("/api/v1/copilot", {
        method: "POST",
        json: { messages: history.filter((turn) => !turn.error).map(({ role, content }) => ({ role, content })) },
      }),
    onSuccess: (data) => setTurns((current) => [...current, { role: "assistant", content: data.answer, tools: data.tools }]),
    onError: (error) => setTurns((current) => [...current, { role: "assistant", content: errorMessage(error), error: true }]),
  });

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, ask.isPending]);

  function send(text: string) {
    const content = text.trim();
    if (!content || ask.isPending) return;
    const history = [...turns, { role: "user" as const, content }];
    setTurns(history);
    setDraft("");
    ask.mutate(history);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4" /> Copilot
          </SheetTitle>
          <SheetDescription>Answers come from your workspace data via the same APIs the app uses.</SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-3" ref={scrollRef}>
          {turns.length === 0 ? (
            <div className="grid gap-2">
              <p className="text-xs text-foreground-muted">Try asking</p>
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-[13px] text-foreground-secondary transition-colors hover:border-border-strong hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
          {turns.map((turn, index) => (
            <div key={index} className={cn("flex", turn.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[90%] rounded-lg px-3 py-2 text-[13px] leading-relaxed",
                  turn.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-surface",
                  turn.error && "border-transparent bg-danger-soft text-danger-text",
                )}
              >
                <RichText text={turn.content} />
                {turn.tools?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1 border-t border-border pt-2">
                    {turn.tools.map((tool, toolIndex) => (
                      <span
                        key={toolIndex}
                        title={tool.error}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[11px]",
                          tool.ok ? "bg-surface-muted text-foreground-muted" : "bg-danger-soft text-danger-text",
                        )}
                      >
                        <Wrench className="size-3" /> {tool.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {ask.isPending ? (
            <div className="flex items-center gap-2 text-xs text-foreground-muted">
              <Spinner className="size-3.5" /> Working…
            </div>
          ) : null}
        </SheetBody>
        <form
          className="border-t border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <div className="flex items-end gap-2 rounded-lg border border-border bg-surface p-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send(draft);
                }
              }}
              rows={2}
              placeholder="Ask about leads, campaigns, spend…"
              className="max-h-40 flex-1 resize-none bg-transparent text-[13px] outline-none placeholder:text-foreground-subtle"
            />
            <button
              type="submit"
              disabled={!draft.trim() || ask.isPending}
              aria-label="Send"
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
