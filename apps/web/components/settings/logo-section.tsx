"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { ImageUp, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
  cn,
  toast,
} from "@repo/ui";
import { api, errorMessage } from "@/lib/api-client";
import { useCanManage, useShell } from "../shell/shell-context";

const MAX_BYTES = 1_000_000;
const ACCEPT = "image/png,image/jpeg,image/webp";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

/**
 * A picture with a small pencil button to change or remove it. Used for your profile photo and
 * the workspace picture; the server re-checks the type (from the bytes) and size.
 */
function EditablePicture({
  label,
  image,
  name,
  endpoint,
  canEdit,
  round,
}: {
  label: string;
  image: string | null;
  name: string;
  endpoint: string;
  canEdit: boolean;
  round?: boolean;
}) {
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [preview, setPreview] = React.useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api(endpoint, { method: "POST", body: form });
    },
    onSuccess: () => {
      toast.success(`${label} updated`);
      router.refresh();
    },
    onError: (error) => {
      setPreview(null);
      toast.error(errorMessage(error));
    },
  });
  const remove = useMutation({
    mutationFn: () => api(endpoint, { method: "DELETE" }),
    onSuccess: () => {
      setPreview(null);
      toast.success(`${label} removed`);
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
      toast.error("Pictures can be up to 1 MB");
      return;
    }
    setPreview(URL.createObjectURL(file));
    upload.mutate(file);
  }

  const shown = preview ?? image;
  const shape = round ? "rounded-full" : "rounded-xl";
  return (
    <div className="relative size-14 shrink-0">
      <div
        className={cn(
          "flex size-full items-center justify-center overflow-hidden border border-border bg-surface-muted",
          shape,
        )}
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- small uploaded pictures served by our own API
          <img
            src={shown}
            alt={name}
            className={cn("size-full", round ? "object-cover" : "object-contain p-1")}
          />
        ) : (
          <span className="text-[17px] font-semibold text-foreground-muted">
            {initials(name) || "?"}
          </span>
        )}
        {upload.isPending || remove.isPending ? (
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center bg-background/70",
              shape,
            )}
          >
            <Spinner className="size-4" />
          </span>
        ) : null}
      </div>
      {canEdit ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Change ${label.toLowerCase()}`}
                className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full border border-border bg-surface text-foreground-secondary shadow-sm transition-colors hover:text-foreground"
              >
                <Pencil className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuItem onSelect={() => input.current?.click()}>
                <ImageUp /> {image ? "Upload a new one" : "Upload a picture"}
              </DropdownMenuItem>
              {image ? (
                <DropdownMenuItem onSelect={() => remove.mutate()} className="text-danger-text">
                  <Trash2 /> Remove
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            aria-label={`Upload ${label.toLowerCase()}`}
            onChange={(event) => {
              choose(event.target.files?.[0] ?? undefined);
              event.target.value = "";
            }}
          />
        </>
      ) : null}
    </div>
  );
}

/** The workspace picture (business logo): sidebar, workspace switcher and quotes you share. */
export function WorkspacePicture() {
  const { workspace } = useShell();
  const canManage = useCanManage();
  return (
    <EditablePicture
      label="Workspace picture"
      image={workspace.logoUrl}
      name={workspace.name}
      endpoint="/api/v1/workspace/logo"
      canEdit={canManage}
    />
  );
}

/** Your profile photo: the sidebar menu and what teammates see. */
export function ProfilePicture() {
  const { user } = useShell();
  return (
    <EditablePicture
      label="Profile photo"
      image={user.image}
      name={user.name}
      endpoint="/api/v1/me/avatar"
      canEdit
      round
    />
  );
}
