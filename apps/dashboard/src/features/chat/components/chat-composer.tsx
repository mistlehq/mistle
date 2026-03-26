import {
  Alert,
  AlertDescription,
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

type ChatComposerStatusMessage = {
  message: string;
  tone: "error" | "warning";
};

type ChatComposerProps = {
  composerText: string;
  composerStatusMessage: ChatComposerStatusMessage | null;
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
  isConnected: boolean;
  isStartingTurn: boolean;
  isSteeringTurn: boolean;
  isInterruptingTurn: boolean;
  isUpdatingComposerConfig: boolean;
  isUploadingAttachments: boolean;
  canInterruptTurn: boolean;
  canSteerTurn: boolean;
  completedErrorMessage: string | null;
  onComposerTextChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onReasoningEffortChange: (value: string) => void;
  onPendingImageFilesAdded: (files: readonly File[]) => void;
  onRemovePendingAttachment: (attachmentId: string) => void;
  onSubmit: () => void;
};

export function ChatComposer({
  composerText,
  composerStatusMessage,
  pendingAttachments,
  modelOptions,
  selectedModel,
  selectedReasoningEffort,
  isConnected,
  isStartingTurn,
  isSteeringTurn,
  isInterruptingTurn,
  isUpdatingComposerConfig,
  isUploadingAttachments,
  canInterruptTurn,
  canSteerTurn,
  completedErrorMessage,
  onComposerTextChange,
  onModelChange,
  onReasoningEffortChange,
  onPendingImageFilesAdded,
  onRemovePendingAttachment,
  onSubmit,
}: ChatComposerProps): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const trimmedComposerText = composerText.trim();
  const hasPendingAttachments = pendingAttachments.length > 0;
  const hasComposerSubmissionContent = trimmedComposerText.length > 0 || hasPendingAttachments;
  const hasActiveTurn = canInterruptTurn || canSteerTurn;
  const composerPlaceholder = hasActiveTurn ? "Steer the current turn" : "Ask anything";
  const composerActionLabel = hasActiveTurn
    ? hasComposerSubmissionContent
      ? isSteeringTurn
        ? "Steering..."
        : "Steer"
      : isInterruptingTurn
        ? "Stopping..."
        : "Stop"
    : isUploadingAttachments
      ? "Uploading..."
      : isStartingTurn
        ? "Sending..."
        : "Send";
  const isComposerActionDisabled = hasActiveTurn
    ? hasComposerSubmissionContent
      ? !canSteerTurn || isUploadingAttachments
      : !canInterruptTurn
    : !isConnected || isStartingTurn || isUploadingAttachments || !hasComposerSubmissionContent;
  const composerActionIcon =
    hasActiveTurn && !hasComposerSubmissionContent ? (
      <StopCircleIcon aria-hidden="true" weight="fill" />
    ) : (
      <ArrowCircleUpIcon aria-hidden="true" weight="fill" />
    );
  const isComposerConfigDisabled =
    !isConnected || isUpdatingComposerConfig || isUploadingAttachments;
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
      {composerStatusMessage === null ? null : (
        <Alert
          className="mx-1 mt-1"
          variant={composerStatusMessage.tone === "error" ? "destructive" : "default"}
        >
          <AlertDescription>{composerStatusMessage.message}</AlertDescription>
        </Alert>
      )}
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
          if (isComposerActionDisabled) {
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="h-8 gap-1.5 rounded-full"
            disabled={!isConnected || isUploadingAttachments}
            onClick={() => {
              fileInputRef.current?.click();
            }}
            type="button"
            variant="outline"
          >
            <PlusIcon aria-hidden="true" className="size-4" />
            Add images
          </Button>

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
      {!isUploadingAttachments ? null : (
        <p className="text-muted-foreground text-sm">Uploading attachments...</p>
      )}
      {completedErrorMessage === null ? null : (
        <p className="text-destructive text-sm">
          <span className="font-medium">Turn error:</span> {completedErrorMessage}
        </p>
      )}
    </div>
  );
}
