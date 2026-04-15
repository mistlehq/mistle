import { Input, Spinner, cn } from "@mistle/ui";
import { CheckCircleIcon } from "@phosphor-icons/react";

export type AutoSaveInputVisualStatus = "idle" | "saving" | "saved" | "saved-fading";

export function AutoSaveInputSurface(input: {
  id: string;
  ariaLabel: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  size?: number;
  inputClassName?: string;
  variant?: "default" | "inline";
  errorMessage?: string;
  saveStatus?: AutoSaveInputVisualStatus;
  idleTrailingAdornment?: React.ReactNode;
  trailingAdornment?: React.ReactNode;
  onBlur?: () => void;
  onChange: (nextValue: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}): React.JSX.Element {
  const saveStatus = input.saveStatus ?? "idle";
  const showIndicator = saveStatus !== "idle" && input.errorMessage === undefined;
  const showIdleAdornment = saveStatus === "idle" && input.errorMessage === undefined;
  const saveState = input.errorMessage === undefined ? saveStatus : "error";
  const showTrailingAdornment = showIndicator || input.idleTrailingAdornment !== undefined;

  return (
    <div className="group space-y-2" data-save-state={saveState}>
      <div
        className={cn("relative", showTrailingAdornment ? "flex items-center gap-2" : undefined)}
      >
        <div className={cn("relative", showTrailingAdornment ? "inline-flex min-w-0" : undefined)}>
          <Input
            aria-invalid={input.errorMessage === undefined ? undefined : true}
            aria-label={input.ariaLabel}
            autoFocus={input.autoFocus}
            className={cn(showTrailingAdornment ? "pr-2" : null, input.inputClassName)}
            disabled={input.disabled}
            id={input.id}
            onBlur={input.onBlur}
            onChange={(event) => {
              input.onChange(event.currentTarget.value);
            }}
            onKeyDown={input.onKeyDown}
            placeholder={input.placeholder}
            size={input.size}
            variant={input.variant}
            value={input.value}
          />
          {showIndicator ? (
            <div className="pointer-events-none absolute inset-y-0 right-0 flex w-2 items-center justify-center">
              <AutoSaveInputIndicator status={saveStatus} />
            </div>
          ) : showIdleAdornment ? (
            <div className="pointer-events-none absolute inset-y-0 right-0 flex w-2 items-center justify-center transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
              {input.idleTrailingAdornment}
            </div>
          ) : null}
        </div>
        {input.trailingAdornment === undefined ? null : input.trailingAdornment}
      </div>
      {input.errorMessage === undefined ? null : (
        <div aria-live="polite" role="status">
          <div className="flex items-center justify-end text-xs text-destructive">
            <span>{input.errorMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function AutoSaveInputIndicator(input: {
  status: AutoSaveInputVisualStatus;
}): React.JSX.Element | null {
  if (input.status === "saving") {
    return (
      <div className="text-muted-foreground flex items-center justify-end">
        <Spinner className="size-3.5" />
        <span className="sr-only">Saving</span>
      </div>
    );
  }

  if (input.status === "saved" || input.status === "saved-fading") {
    return (
      <div
        className={cn(
          "flex items-center justify-end text-emerald-700 transition-opacity duration-700",
          input.status === "saved" ? "opacity-100" : "opacity-0",
        )}
      >
        <CheckCircleIcon aria-hidden className="size-4" weight="fill" />
        <span className="sr-only">Saved</span>
      </div>
    );
  }

  return null;
}
