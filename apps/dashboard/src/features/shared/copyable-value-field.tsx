import { systemScheduler } from "@mistle/time";
import { Button } from "@mistle/ui";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

const COPY_SUCCESS_DISPLAY_MS = 1200;

export function CopyableValueField(input: {
  copiedTitle?: string;
  copyAriaLabel?: string;
  copyTitle?: string;
  label: string;
  value: string;
}): React.JSX.Element {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(input.value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  useEffect(() => {
    if (copyState !== "copied") {
      return;
    }

    const handle = systemScheduler.schedule(() => {
      setCopyState("idle");
    }, COPY_SUCCESS_DISPLAY_MS);

    return () => {
      systemScheduler.cancel(handle);
    };
  }, [copyState]);

  return (
    <div className="gap-1.5 flex flex-col">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">{input.label}</p>
      <div className="bg-muted/30 flex items-center gap-2 rounded-md border p-2">
        <p className="min-w-0 flex-1 break-all px-1 font-mono text-xs">{input.value}</p>
        <Button
          aria-label={input.copyAriaLabel ?? `Copy ${input.label}`}
          className="shrink-0"
          onClick={() => {
            void handleCopy();
          }}
          size="icon-sm"
          title={
            copyState === "copied"
              ? (input.copiedTitle ?? "Copied")
              : (input.copyTitle ?? `Copy ${input.label}`)
          }
          type="button"
          variant="outline"
        >
          {copyState === "copied" ? (
            <CheckIcon aria-hidden className="size-4 text-emerald-600" />
          ) : (
            <CopyIcon
              aria-hidden
              className={copyState === "failed" ? "text-destructive size-4" : "size-4"}
            />
          )}
        </Button>
      </div>
      {copyState === "failed" ? (
        <p className="text-destructive text-xs">Could not copy automatically.</p>
      ) : null}
    </div>
  );
}
