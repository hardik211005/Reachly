import * as React from "react";
import { cn } from "../lib/utils";

export const inputClasses =
  "flex h-8 w-full min-w-0 rounded-md border border-border bg-surface px-2.5 text-[13px] text-foreground shadow-xs transition-[border,box-shadow] duration-150 placeholder:text-foreground-subtle outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-critical aria-invalid:ring-critical/20 file:border-0 file:bg-transparent file:text-sm file:font-medium";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input ref={ref} type={type} className={cn(inputClasses, className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(inputClasses, "h-auto min-h-20 resize-y py-2 leading-relaxed", className)}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
