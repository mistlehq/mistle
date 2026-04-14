import { systemScheduler } from "@mistle/time";
import { Button, cn } from "@mistle/ui";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

const COPY_SUCCESS_DISPLAY_MS = 1200;

type CopyFeedback =
  | { state: "idle" }
  | {
      state: "copied" | "failed";
      value: string;
    };

type CopyableValueProps =
  | {
      copiedTitle?: string;
      copyAriaLabel?: string;
      copyTitle?: string;
      failureMessage?: string;
      label: string;
      value: string;
      variant?: "field";
    }
  | {
      copiedTitle?: string;
      copyAriaLabel?: string;
      copyTitle?: string;
      failureMessage?: string;
      value: string;
      variant: "panel";
    };

export function CopyableValue(input: CopyableValueProps): React.JSX.Element {
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>({ state: "idle" });

  const copyAriaLabel =
    input.copyAriaLabel ?? (input.variant === "panel" ? "Copy value" : `Copy ${input.label}`);
  const idleTitle =
    input.copyTitle ?? (input.variant === "panel" ? "Copy value" : `Copy ${input.label}`);
  const visibleCopyState =
    copyFeedback.state === "idle" || copyFeedback.value !== input.value
      ? "idle"
      : copyFeedback.state;

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(input.value);
      setCopyFeedback({
        state: "copied",
        value: input.value,
      });
    } catch {
      setCopyFeedback({
        state: "failed",
        value: input.value,
      });
    }
  }

  useEffect(() => {
    if (copyFeedback.state !== "copied") {
      return;
    }

    const handle = systemScheduler.schedule(() => {
      setCopyFeedback((currentFeedback) => {
        if (currentFeedback.state !== "copied" || currentFeedback.value !== copyFeedback.value) {
          return currentFeedback;
        }

        return { state: "idle" };
      });
    }, COPY_SUCCESS_DISPLAY_MS);

    return () => {
      systemScheduler.cancel(handle);
    };
  }, [copyFeedback]);

  const button = (
    <Button
      aria-label={copyAriaLabel}
      className={input.variant === "panel" ? "absolute top-2 right-2 z-10" : "shrink-0"}
      onClick={() => {
        void handleCopy();
      }}
      size="icon-sm"
      title={visibleCopyState === "copied" ? (input.copiedTitle ?? "Copied") : idleTitle}
      type="button"
      variant={input.variant === "panel" ? "ghost" : "outline"}
    >
      {visibleCopyState === "copied" ? (
        <CheckIcon aria-hidden className="size-4 text-emerald-600" />
      ) : (
        <CopyIcon
          aria-hidden
          className={cn(visibleCopyState === "failed" ? "text-destructive" : null, "size-4")}
        />
      )}
    </Button>
  );

  if (input.variant === "panel") {
    return (
      <div className="bg-muted relative min-h-0 flex-1 rounded-md border">
        {button}
        <pre className="text-muted-foreground h-full overflow-auto p-3 text-xs whitespace-pre-wrap break-words">
          {input.value}
        </pre>
        {visibleCopyState === "failed" ? (
          <p className="text-destructive mt-2 px-3 pb-3 text-xs">
            {input.failureMessage ?? "Could not copy automatically."}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="gap-1.5 flex flex-col">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">{input.label}</p>
      <div className="bg-muted/30 flex items-center gap-2 rounded-md border p-2">
        <p className="min-w-0 flex-1 break-all px-1 font-mono text-xs">{input.value}</p>
        {button}
      </div>
      {visibleCopyState === "failed" ? (
        <p className="text-destructive text-xs">
          {input.failureMessage ?? "Could not copy automatically."}
        </p>
      ) : null}
    </div>
  );
}
