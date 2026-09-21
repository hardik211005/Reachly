"use client";

import { Toaster as SonnerToaster, toast } from "sonner";

export function Toaster({ theme }: { theme?: "light" | "dark" | "system" }) {
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "!rounded-lg !border !border-border !bg-surface-raised !text-foreground !shadow-md !text-[13px] !font-sans",
          description: "!text-foreground-muted",
          actionButton: "!bg-primary !text-primary-foreground",
          cancelButton: "!bg-surface-muted !text-foreground",
        },
      }}
    />
  );
}

export { toast };
