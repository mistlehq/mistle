import { systemScheduler } from "@mistle/time";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { cn } from "../../lib/utils.js";
import { Button } from "./button.js";
import { Spinner } from "./spinner.js";

const COPY_SUCCESS_DISPLAY_MS = 1200;

type CopyFeedback =
  | { state: "idle" }
  | {
      state: "copied" | "failed";
      value: string;
    };

type LoadingCopyableValueProps = {
  label: string;
  loading: true;
  loadingLabel?: string;
  variant?: "field";
};

type ReadyCopyableValueBaseProps = {
  copiedTitle?: string;
  copyAriaLabel?: string;
  copyTitle?: string;
  failureMessage?: string;
  value: string;
};

type ReadyFieldCopyableValueProps = ReadyCopyableValueBaseProps & {
  label: string;
  variant?: "field";
};

type ReadyInlineCopyableValueProps = ReadyCopyableValueBaseProps & {
  variant: "inline";
};

type ReadyPanelCopyableValueProps = ReadyCopyableValueBaseProps & {
  variant: "panel";
};

type ReadyCopyableValueProps =
  | ReadyFieldCopyableValueProps
  | ReadyInlineCopyableValueProps
  | ReadyPanelCopyableValueProps;

export type CopyableValueProps = LoadingCopyableValueProps | ReadyCopyableValueProps;

function isLoadingCopyableValue(input: CopyableValueProps): input is LoadingCopyableValueProps {
  return "loading" in input && input.loading;
}

export function CopyableValue(input: CopyableValueProps): React.JSX.Element {
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>({ state: "idle" });
  const isLoading = isLoadingCopyableValue(input);

  useEffect(() => {
    if (isLoading || copyFeedback.state !== "copied") {
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
  }, [copyFeedback, isLoading]);

  if (isLoadingCopyableValue(input)) {
    return (
      <div className="gap-1.5 flex flex-col">
        <p className="text-muted-foreground text-xs uppercase tracking-wide">{input.label}</p>
        <div className="bg-muted/30 flex items-center gap-2 rounded-md border p-2">
          <div className="min-w-0 flex flex-1 items-center gap-2 px-1 font-mono text-xs">
            <Spinner
              aria-label={`Loading ${input.label}`}
              className="size-4 text-muted-foreground"
            />
            <p className="text-muted-foreground">{input.loadingLabel ?? "Loading…"}</p>
          </div>
          <div aria-hidden className="size-8 shrink-0" />
        </div>
      </div>
    );
  }

  const readyInput = input;

  const copyAriaLabel =
    readyInput.copyAriaLabel ??
    (readyInput.variant === "panel" || readyInput.variant === "inline"
      ? "Copy value"
      : `Copy ${readyInput.label}`);
  const idleTitle =
    readyInput.copyTitle ??
    (readyInput.variant === "panel" || readyInput.variant === "inline"
      ? "Copy value"
      : `Copy ${readyInput.label}`);
  const visibleCopyState =
    copyFeedback.state === "idle" || copyFeedback.value !== readyInput.value
      ? "idle"
      : copyFeedback.state;

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(readyInput.value);
      setCopyFeedback({
        state: "copied",
        value: readyInput.value,
      });
    } catch {
      setCopyFeedback({
        state: "failed",
        value: readyInput.value,
      });
    }
  }

  const button = (
    <Button
      aria-label={copyAriaLabel}
      className={readyInput.variant === "panel" ? "absolute top-2 right-2 z-10" : "shrink-0"}
      onClick={() => {
        void handleCopy();
      }}
      size="icon-sm"
      title={visibleCopyState === "copied" ? (readyInput.copiedTitle ?? "Copied") : idleTitle}
      type="button"
      variant={readyInput.variant === "panel" ? "ghost" : "outline"}
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

  if (readyInput.variant === "panel") {
    return (
      <div className="bg-muted relative min-h-0 flex-1 rounded-md border">
        {button}
        <pre className="text-muted-foreground h-full overflow-auto p-3 text-xs whitespace-pre-wrap break-words">
          {readyInput.value}
        </pre>
        {visibleCopyState === "failed" ? (
          <p className="text-destructive mt-2 px-3 pb-3 text-xs">
            {readyInput.failureMessage ?? "Could not copy automatically."}
          </p>
        ) : null}
      </div>
    );
  }

  if (readyInput.variant === "inline") {
    return (
      <div className="gap-1.5 flex flex-col">
        <div className="bg-muted/30 flex items-center gap-2 rounded-md border p-2">
          <p className="min-w-0 flex-1 break-all px-1 font-mono text-xs">{readyInput.value}</p>
          {button}
        </div>
        {visibleCopyState === "failed" ? (
          <p className="text-destructive text-xs">
            {readyInput.failureMessage ?? "Could not copy automatically."}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="gap-1.5 flex flex-col">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">{readyInput.label}</p>
      <div className="bg-muted/30 flex items-center gap-2 rounded-md border p-2">
        <p className="min-w-0 flex-1 break-all px-1 font-mono text-xs">{readyInput.value}</p>
        {button}
      </div>
      {visibleCopyState === "failed" ? (
        <p className="text-destructive text-xs">
          {readyInput.failureMessage ?? "Could not copy automatically."}
        </p>
      ) : null}
    </div>
  );
}
