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
  inputClassName?: string;
  errorMessage?: string;
  saveStatus?: AutoSaveInputVisualStatus;
  onBlur?: () => void;
  onChange: (nextValue: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}): React.JSX.Element {
  const saveStatus = input.saveStatus ?? "idle";
  const showIndicator = saveStatus !== "idle" && input.errorMessage === undefined;
  const saveState = input.errorMessage === undefined ? saveStatus : "error";

  return (
    <div className="space-y-2" data-save-state={saveState}>
      <div className="relative">
        <Input
          aria-invalid={input.errorMessage === undefined ? undefined : true}
          aria-label={input.ariaLabel}
          autoFocus={input.autoFocus}
          className={cn(showIndicator ? "pr-9" : null, input.inputClassName)}
          disabled={input.disabled}
          id={input.id}
          onBlur={input.onBlur}
          onChange={(event) => {
            input.onChange(event.currentTarget.value);
          }}
          onKeyDown={input.onKeyDown}
          placeholder={input.placeholder}
          value={input.value}
        />
        {showIndicator ? (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
            <AutoSaveInputIndicator status={saveStatus} />
          </div>
        ) : null}
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
