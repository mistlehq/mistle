import { OpenAiReasoningEffortLabelByValue } from "@mistle/integrations-definitions";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@mistle/ui";
import { ArrowCircleUpIcon, PlusIcon, StopCircleIcon, XIcon } from "@phosphor-icons/react";
import { useRef } from "react";

import { resolveSelectableValue } from "../../shared/select-value.js";

const REASONING_EFFORT_OPTIONS = ["low", "medium", "high", "xhigh"] as const;
const ReasoningEffortLabels: Readonly<Record<string, string>> = OpenAiReasoningEffortLabelByValue;

function formatReasoningEffortLabel(value: string): string {
  return ReasoningEffortLabels[value] ?? value;
}

export type ChatComposerStatusMessage = {
  message: string;
  variant: "alert" | "default";
  presentation?: "loading" | "notice";
};

export type ChatComposerViewModel = {
  composerText: string;
  pendingAttachments: readonly {
    id: string;
    name: string;
  }[];
  modelOptions: readonly {
    value: string;
    label: string;
  }[];
  selectedModel: string | null;
  selectedReasoningEffort: string | null;
  submitMode: "start" | "steer" | "interrupt";
  submitLabel: string;
  submitDisabled: boolean;
  submitDisabledReason: string | null;
  canUploadAttachments: boolean;
  isUploadingAttachments: boolean;
  configControlsDisabled: boolean;
  onComposerTextChange: (value: string) => void;
  onSubmit: () => void;
  onModelChange: (value: string) => void;
  onReasoningEffortChange: (value: string) => void;
  onPendingImageFilesAdded: (files: readonly File[]) => void;
  onRemovePendingAttachment: (attachmentId: string) => void;
};

export function ChatComposer({
  composerText,
  pendingAttachments,
  modelOptions,
  selectedModel,
  selectedReasoningEffort,
  submitMode,
  submitLabel,
  submitDisabled,
  canUploadAttachments,
  isUploadingAttachments,
  configControlsDisabled,
  onComposerTextChange,
  onSubmit,
  onModelChange,
  onReasoningEffortChange,
  onPendingImageFilesAdded,
  onRemovePendingAttachment,
}: ChatComposerViewModel): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerPlaceholder =
    submitMode === "steer" || submitMode === "interrupt"
      ? "Steer the current turn"
      : "Ask anything";
  const composerActionIcon =
    submitMode === "interrupt" ? (
      <StopCircleIcon aria-hidden="true" weight="fill" />
    ) : (
      <ArrowCircleUpIcon aria-hidden="true" weight="fill" />
    );
  const selectableModelValue = resolveSelectableValue({
    selectedValue: selectedModel,
    optionValues: modelOptions.map((option) => option.value),
  });
  const selectedModelLabel = modelOptions.find((option) => option.value === selectedModel)?.label;
  const selectedReasoningEffortValue = resolveSelectableValue({
    selectedValue: selectedReasoningEffort,
    optionValues: REASONING_EFFORT_OPTIONS,
  });

  function addPendingFiles(files: readonly File[]): void {
    if (files.length === 0) {
      return;
    }

    onPendingImageFilesAdded(files);
  }

  return (
    <div
      className="bg-card flex flex-col gap-3 rounded-md border p-1 shadow-xs"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        addPendingFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        accept="image/*"
        className="hidden"
        multiple
        onChange={(event) => {
          addPendingFiles(Array.from(event.target.files ?? []));
          event.currentTarget.value = "";
        }}
        ref={fileInputRef}
        type="file"
      />
      {pendingAttachments.length === 0 ? null : (
        <div className="flex flex-wrap gap-2 px-1 pt-1">
          {pendingAttachments.map((attachment) => (
            <div
              className="bg-muted flex items-center gap-2 rounded-full px-3 py-1 text-xs"
              key={attachment.id}
            >
              <span>{attachment.name}</span>
              <button
                aria-label={`Remove ${attachment.name}`}
                className="text-muted-foreground disabled:cursor-not-allowed"
                disabled={isUploadingAttachments}
                onClick={() => {
                  onRemovePendingAttachment(attachment.id);
                }}
                type="button"
              >
                <XIcon aria-hidden="true" className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
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
          if (submitDisabled) {
            return;
          }

          onSubmit();
        }}
        onPaste={(event) => {
          const clipboardFiles = Array.from(event.clipboardData.files);
          if (clipboardFiles.length === 0) {
            return;
          }

          event.preventDefault();
          addPendingFiles(clipboardFiles);
        }}
        placeholder={composerPlaceholder}
        rows={2}
        value={composerText}
      />
      <div className="flex items-center gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5 md:flex md:flex-wrap md:items-center md:gap-2">
          <Button
            aria-label="Add images"
            className="text-muted-foreground h-8 min-w-0 rounded-md px-1.5 hover:bg-muted/60"
            disabled={!canUploadAttachments || isUploadingAttachments}
            onClick={() => {
              fileInputRef.current?.click();
            }}
            type="button"
            variant="ghost"
          >
            <PlusIcon aria-hidden="true" className="size-4" />
          </Button>

          <Select
            disabled={configControlsDisabled}
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
              className="text-muted-foreground h-8 w-full min-w-0 border-0 bg-transparent px-2 shadow-none hover:bg-muted/60 md:w-fit md:px-2.5 data-[state=open]:bg-muted/70"
              size="sm"
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
            disabled={configControlsDisabled}
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
              className="text-muted-foreground h-8 w-full min-w-0 border-0 bg-transparent px-2 shadow-none hover:bg-muted/60 md:w-fit md:px-2.5 data-[state=open]:bg-muted/70"
              size="sm"
            >
              <SelectValue className="text-muted-foreground" placeholder="Reasoning">
                {selectedReasoningEffortValue === null
                  ? "Reasoning"
                  : formatReasoningEffortLabel(selectedReasoningEffortValue)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {REASONING_EFFORT_OPTIONS.map((reasoningOption) => (
                <SelectItem key={reasoningOption} value={reasoningOption}>
                  {formatReasoningEffortLabel(reasoningOption)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          aria-label={submitLabel}
          className="shrink-0 rounded-full bg-transparent text-primary hover:bg-transparent"
          disabled={submitDisabled}
          onClick={onSubmit}
          size="icon-fill"
          title={submitLabel}
          type="button"
          variant="ghost"
        >
          {composerActionIcon}
        </Button>
      </div>
    </div>
  );
}
