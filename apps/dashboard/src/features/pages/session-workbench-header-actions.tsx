import {
  Badge,
  Button,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  Spinner,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";
import { GitDiffIcon, TerminalIcon } from "@phosphor-icons/react";

import { resolveSelectableValue } from "../shared/select-value.js";

export type SessionWorkbenchHeaderRepositoryOption = {
  value: string;
  label: string;
};

type SessionWorkbenchHeaderRepositoryControl = {
  ariaLabel: string;
  disabled?: boolean;
  errorMessage?: string;
  isRefreshing?: boolean;
  onOpenChange?: (open: boolean) => void;
  onValueChange: (nextValue: string) => void;
  options: ReadonlyArray<SessionWorkbenchHeaderRepositoryOption>;
  selectedValue: string | null;
  title?: string;
};

type SessionWorkbenchHeaderButtonControl = {
  ariaLabel: string;
  className: string;
  disabled: boolean;
  onClick: () => void;
  pressed: boolean;
  title: string;
};

export function SessionWorkbenchHeaderActions(input: {
  cliControl: SessionWorkbenchHeaderButtonControl;
  diffControl: SessionWorkbenchHeaderButtonControl;
  extraActions?: React.ReactNode;
  repositoryControl?: SessionWorkbenchHeaderRepositoryControl;
  status: {
    kind: "connected" | "error" | "not_connected";
    label: string;
  };
  terminalControl: SessionWorkbenchHeaderButtonControl;
}): React.JSX.Element {
  const repositoryControl = input.repositoryControl;
  const selectedRepositoryLabel =
    repositoryControl === undefined
      ? null
      : (repositoryControl.options.find(
          (option) => option.value === repositoryControl.selectedValue,
        )?.label ?? null);
  const repositoryIndicator =
    repositoryControl === undefined ? null : repositoryControl.isRefreshing === true ? (
      <Spinner aria-label="Refreshing repositories" className="size-3.5 text-muted-foreground" />
    ) : undefined;

  return (
    <div className="flex items-center gap-2">
      {input.status.kind === "error" ? (
        <Badge aria-label={input.status.label} title={input.status.label} variant="destructive">
          {input.status.label}
        </Badge>
      ) : (
        <span
          aria-label={input.status.label}
          className={[
            "inline-block size-2.5 rounded-full border",
            input.status.kind === "connected"
              ? "border-emerald-700 bg-emerald-600"
              : "border-stone-300 bg-stone-300",
          ].join(" ")}
          role="status"
          title={input.status.label}
        />
      )}
      {repositoryControl === undefined ? null : (
        <>
          <span aria-hidden className="h-5 w-px bg-stone-200" />
          <Select
            disabled={repositoryControl.disabled}
            onOpenChange={repositoryControl.onOpenChange}
            onValueChange={(nextValue) => {
              if (nextValue === null) {
                return;
              }

              repositoryControl.onValueChange(nextValue);
            }}
            value={resolveSelectableValue({
              selectedValue: repositoryControl.selectedValue,
              optionValues: repositoryControl.options.map((option) => option.value),
            })}
          >
            <SelectTrigger
              aria-label={repositoryControl.ariaLabel}
              className="h-8 w-48 min-w-0 border-stone-200 bg-transparent text-sm shadow-none hover:bg-stone-100"
              indicator={repositoryIndicator}
              title={repositoryControl.title ?? repositoryControl.ariaLabel}
            >
              <SelectValue className="min-w-0 truncate" placeholder="Primary repository">
                {selectedRepositoryLabel ?? "Primary repository"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {repositoryControl.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
              {repositoryControl.errorMessage === undefined ? null : (
                <>
                  <SelectSeparator />
                  <Notice
                    variant="alert"
                    appearance="subtle"
                    className="rounded-none border-0 bg-transparent px-3 py-2 text-xs"
                    role="note"
                  >
                    {repositoryControl.errorMessage}
                  </Notice>
                </>
              )}
            </SelectContent>
          </Select>
        </>
      )}
      <span aria-hidden className="h-5 w-px bg-stone-200" />
      <Button
        aria-label={input.cliControl.ariaLabel}
        aria-pressed={input.cliControl.pressed}
        className={input.cliControl.className}
        disabled={input.cliControl.disabled}
        onClick={input.cliControl.onClick}
        size="sm"
        title={input.cliControl.title}
        type="button"
        variant="ghost"
      >
        TUI
      </Button>
      <Button
        aria-label={input.diffControl.ariaLabel}
        aria-pressed={input.diffControl.pressed}
        className={input.diffControl.className}
        disabled={input.diffControl.disabled}
        onClick={input.diffControl.onClick}
        size="icon-sm"
        title={input.diffControl.title}
        type="button"
        variant="ghost"
      >
        <GitDiffIcon className="size-4" />
      </Button>
      {input.extraActions}
      <Button
        aria-label={input.terminalControl.ariaLabel}
        aria-pressed={input.terminalControl.pressed}
        className={input.terminalControl.className}
        disabled={input.terminalControl.disabled}
        onClick={input.terminalControl.onClick}
        size="icon-sm"
        title={input.terminalControl.title}
        type="button"
        variant="ghost"
      >
        <TerminalIcon className="size-4" />
      </Button>
    </div>
  );
}
