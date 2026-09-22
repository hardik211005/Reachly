"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { ImageUp, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button, Spinner, cn, toast } from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanManage, useShell } from "../shell/shell-context";
import { Section } from "./kit";

const MAX_BYTES = 1_000_000;
const ACCEPT = "image/png,image/jpeg,image/webp";

/** Upload the workspace's brand logo: shown in the sidebar and on quotes you share. */
export function LogoSection() {
  const router = useRouter();
  const { workspace } = useShell();
  const canManage = useCanManage();
  const input = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [preview, setPreview] = React.useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api<{ logoUrl: string }>("/api/v1/workspace/logo", { method: "POST", body: form });
    },
    onSuccess: () => {
      toast.success("Logo updated");
      router.refresh();
    },
    onError: (error) => {
      setPreview(null);
      toast.error(errorMessage(error));
    },
  });
  const remove = useMutation({
    mutationFn: () => api("/api/v1/workspace/logo", { method: "DELETE" }),
    onSuccess: () => {
      setPreview(null);
      toast.success("Logo removed");
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function choose(file: File | undefined) {
    if (!file) return;
    if (!ACCEPT.split(",").includes(file.type)) {
      toast.error("Use a PNG, JPG or WebP image");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Logos can be up to 1 MB");
      return;
    }
    setPreview(URL.createObjectURL(file));
    upload.mutate(file);
  }

  const shown = preview ?? workspace.logoUrl;
  return (
    <Section title="Brand logo" description="Shown in the sidebar and on quotes you share. PNG, JPG or WebP, up to 1 MB — a square image works best." icon={ImageUp}>
      <div className="flex flex-wrap items-center gap-5">
        <div className="relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-background">
          <AnimatePresence mode="wait">
            {shown ? (
              <motion.img key={shown} src={shown} alt={`${workspace.name} logo`} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="size-full object-contain p-2" />
            ) : (
              <motion.span key="initial" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[32px] font-semibold text-foreground-subtle">
                {workspace.name.slice(0, 1).toUpperCase()}
              </motion.span>
            )}
          </AnimatePresence>
          {upload.isPending ? (
            <span className="absolute inset-0 flex items-center justify-center bg-background/70">
              <Spinner />
            </span>
          ) : null}
        </div>
        {canManage ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => input.current?.click()}
            onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && input.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              choose(event.dataTransfer.files[0]);
            }}
            className={cn("flex min-w-60 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed px-6 py-6 text-center transition-colors", dragging ? "border-accent bg-accent-soft/40" : "border-border-strong hover:bg-surface-muted/60")}
          >
            <ImageUp className="size-5 text-foreground-muted" />
            <p className="text-[13.5px] font-medium">{dragging ? "Drop to upload" : "Drop a logo here, or click to choose"}</p>
            <p className="text-[12px] text-foreground-muted">PNG, JPG or WebP · up to 1 MB</p>
            <input ref={input} type="file" accept={ACCEPT} className="sr-only" aria-label="Upload a logo" onChange={(event) => choose(event.target.files?.[0] ?? undefined)} />
          </div>
        ) : (
          <p className="text-[13px] text-foreground-muted">Only workspace admins can change the logo.</p>
        )}
        {canManage && workspace.logoUrl ? (
          <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
            <Trash2 /> Remove
          </Button>
        ) : null}
      </div>
    </Section>
  );
}
