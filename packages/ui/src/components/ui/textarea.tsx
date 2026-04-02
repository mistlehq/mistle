import * as React from "react";

import { cn } from "../../lib/utils.js";

type TextareaFieldShellFocusMode = "focus-visible" | "focus-within";

function textareaFieldShellClassName(input: { focusMode: TextareaFieldShellFocusMode }): string {
  return cn(
    "border-input dark:bg-input/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/25 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-md border bg-transparent shadow-xs transition-[color,box-shadow] outline-none",
    input.focusMode === "focus-visible"
      ? "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      : "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        textareaFieldShellClassName({ focusMode: "focus-visible" }),
        "px-2.5 py-2 text-base md:text-sm placeholder:text-muted-foreground flex field-sizing-content min-h-16 w-full disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea, textareaFieldShellClassName };
