import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@mistle/ui";
import { ArrowCircleUpIcon, StopCircleIcon } from "@phosphor-icons/react";

import { resolveSelectableValue } from "../../shared/select-value.js";

const REASONING_EFFORT_OPTIONS = ["low", "medium", "high", "xhigh"] as const;

type ChatComposerProps = {
  composerText: string;
  modelOptions: readonly {
    value: string;
    label: string;
  }[];
  selectedModel: string | null;
  selectedReasoningEffort: string | null;
  isConnected: boolean;
  isStartingTurn: boolean;
  isSteeringTurn: boolean;
  isInterruptingTurn: boolean;
  isUpdatingComposerConfig: boolean;
  canInterruptTurn: boolean;
  canSteerTurn: boolean;
  completedErrorMessage: string | null;
  onComposerTextChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onReasoningEffortChange: (value: string) => void;
  onSubmit: () => void;
};

export function ChatComposer({
  composerText,
  modelOptions,
  selectedModel,
  selectedReasoningEffort,
  isConnected,
  isStartingTurn,
  isSteeringTurn,
  isInterruptingTurn,
  isUpdatingComposerConfig,
  canInterruptTurn,
  canSteerTurn,
  completedErrorMessage,
  onComposerTextChange,
  onModelChange,
  onReasoningEffortChange,
  onSubmit,
}: ChatComposerProps): React.JSX.Element {
  const trimmedComposerText = composerText.trim();
  const hasComposerText = trimmedComposerText.length > 0;
  const hasActiveTurn = canInterruptTurn || canSteerTurn;
  const composerPlaceholder = hasActiveTurn ? "Steer the current turn" : "Ask anything";
  const composerActionLabel = hasActiveTurn
    ? hasComposerText
      ? isSteeringTurn
        ? "Steering..."
        : "Steer"
      : isInterruptingTurn
        ? "Stopping..."
        : "Stop"
    : isStartingTurn
      ? "Sending..."
      : "Send";
  const isComposerActionDisabled = hasActiveTurn
    ? hasComposerText
      ? !canSteerTurn
      : !canInterruptTurn
    : !isConnected || isStartingTurn || !hasComposerText;
  const composerActionIcon =
    hasActiveTurn && !hasComposerText ? (
      <StopCircleIcon aria-hidden="true" weight="fill" />
    ) : (
      <ArrowCircleUpIcon aria-hidden="true" weight="fill" />
    );
  const isComposerConfigDisabled = !isConnected || isUpdatingComposerConfig;
  const selectableModelValue = resolveSelectableValue({
    selectedValue: selectedModel,
    optionValues: modelOptions.map((option) => option.value),
  });
  const selectedModelLabel = modelOptions.find((option) => option.value === selectedModel)?.label;
  const selectedReasoningEffortValue = resolveSelectableValue({
    selectedValue: selectedReasoningEffort,
    optionValues: REASONING_EFFORT_OPTIONS,
  });

  return (
    <div className="bg-card flex flex-col gap-3 rounded-md border p-1 shadow-xs">
      <Textarea
        className="min-h-12 resize-none border-0 bg-transparent p-1 text-sm shadow-none placeholder:text-muted-foreground/60 focus-visible:border-transparent focus-visible:ring-0"
        id="session-composer"
        onChange={(event) => {
          onComposerTextChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) {
            return;
          }

          event.preventDefault();
          if (isComposerActionDisabled) {
            return;
          }

          onSubmit();
        }}
        placeholder={composerPlaceholder}
        rows={2}
        value={composerText}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            disabled={isComposerConfigDisabled}
            onValueChange={(value) => {
              if (value === null) {
                return;
              }
              onModelChange(value);
            }}
            value={selectableModelValue}
          >
            <SelectTrigger
              aria-label="Model switcher"
              className="text-muted-foreground h-8 w-[11rem] border-0 bg-transparent shadow-none hover:bg-muted/60 data-[state=open]:bg-muted/70"
            >
              <SelectValue className="text-muted-foreground" placeholder="Model">
                {selectedModelLabel ?? "Model"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((modelOption) => (
                <SelectItem key={modelOption.value} value={modelOption.value}>
                  {modelOption.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            disabled={isComposerConfigDisabled}
            onValueChange={(value) => {
              if (value === null) {
                return;
              }
              onReasoningEffortChange(value);
            }}
            value={selectedReasoningEffortValue}
          >
            <SelectTrigger
              aria-label="Reasoning switcher"
              className="text-muted-foreground h-8 w-[8.5rem] border-0 bg-transparent shadow-none hover:bg-muted/60 data-[state=open]:bg-muted/70"
            >
              <SelectValue className="text-muted-foreground" placeholder="Reasoning">
                {selectedReasoningEffortValue ?? "Reasoning"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {REASONING_EFFORT_OPTIONS.map((reasoningOption) => (
                <SelectItem key={reasoningOption} value={reasoningOption}>
                  {reasoningOption}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          aria-label={composerActionLabel}
          className="rounded-full bg-transparent text-primary hover:bg-transparent"
          disabled={isComposerActionDisabled}
          onClick={onSubmit}
          size="icon-fill"
          title={composerActionLabel}
          type="button"
          variant="ghost"
        >
          {composerActionIcon}
        </Button>
      </div>
      {completedErrorMessage === null ? null : (
        <p className="text-destructive text-sm">
          <span className="font-medium">Turn error:</span> {completedErrorMessage}
        </p>
      )}
    </div>
  );
}
