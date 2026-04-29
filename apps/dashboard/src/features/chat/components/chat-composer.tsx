import { OpenAiReasoningEffortLabelByValue } from "@mistle/integrations-definitions/openai";
import {
  Button,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Kbd,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  TextLink,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import {
  ArrowCircleUpIcon,
  ChatCircleTextIcon,
  CircleNotchIcon,
  GaugeIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  PlusIcon,
  StopCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useRef } from "react";

import { resolveSelectableValue } from "../../shared/select-value.js";

const REASONING_EFFORT_OPTIONS = ["low", "medium", "high", "xhigh"] as const;
const ReasoningEffortLabels: Readonly<Record<string, string>> = OpenAiReasoningEffortLabelByValue;

function formatReasoningEffortLabel(value: string): string {
  return ReasoningEffortLabels[value] ?? value;
}

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = navigator.platform || navigator.userAgent;
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

function resolveShortcutDisplayLabel(shortcut: string): string {
  if (shortcut === "enter") {
    return "Enter";
  }

  if (shortcut === "mod-enter") {
    return isApplePlatform() ? "⌘Enter" : "Ctrl+Enter";
  }

  return shortcut;
}

export type ChatComposerStatusMessage = {
  message: string;
  variant: "alert" | "default";
  presentation?: "loading" | "notice";
};

export type ChatComposerViewModel = {
  composerText: string;
  gitBranchLabel: string | null;
  pullRequest: {
    isDraft: boolean;
    number: number;
    state: string;
    title: string;
    url: string;
  } | null;
  contextUsage: {
    label: string;
    title: string;
  } | null;
  pendingDiffCommentSummary: {
    count: number;
    label: string;
    title: string;
  } | null;
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
  isSubmitPending: boolean;
  submitMode: "start" | "steer" | "interrupt";
  submitLabel: string;
  submitDisabled: boolean;
  submitDisabledReason: string | null;
  keyboardShortcuts?: readonly {
    action: string;
    shortcut: string;
  }[];
  secondarySubmitDisabled?: boolean;
  canUploadAttachments: boolean;
  isUploadingAttachments: boolean;
  configControlsDisabled: boolean;
  onComposerTextChange: (value: string) => void;
  onSubmit: () => void;
  onSecondarySubmit?: () => void;
  onModelChange: (value: string) => void;
  onReasoningEffortChange: (value: string) => void;
  onPendingImageFilesAdded: (files: readonly File[]) => void;
  onClearPendingDiffComments: () => void;
  onRemovePendingAttachment: (attachmentId: string) => void;
};

export function ChatComposer({
  composerText,
  gitBranchLabel,
  pullRequest,
  contextUsage,
  pendingDiffCommentSummary,
  pendingAttachments,
  modelOptions,
  selectedModel,
  selectedReasoningEffort,
  isSubmitPending,
  submitMode,
  submitLabel,
  submitDisabled,
  keyboardShortcuts,
  secondarySubmitDisabled = true,
  canUploadAttachments,
  isUploadingAttachments,
  configControlsDisabled,
  onComposerTextChange,
  onSubmit,
  onSecondarySubmit,
  onModelChange,
  onReasoningEffortChange,
  onPendingImageFilesAdded,
  onClearPendingDiffComments,
  onRemovePendingAttachment,
}: ChatComposerViewModel): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerPlaceholder =
    submitMode === "steer" || submitMode === "interrupt"
      ? "Steer the current turn"
      : "Ask anything";
  const composerActionIcon =
    submitMode === "interrupt" ? (
      <StopCircleIcon aria-hidden="true" className="size-5" weight="fill" />
    ) : isSubmitPending ? (
      <CircleNotchIcon aria-hidden="true" className="size-5 animate-spin" weight="fill" />
    ) : (
      <ArrowCircleUpIcon aria-hidden="true" className="size-5" weight="fill" />
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
      className="flex flex-col"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        addPendingFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="bg-card flex flex-col gap-3 rounded-md border p-1.5 shadow-xs">
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
        {pendingAttachments.length === 0 && pendingDiffCommentSummary === null ? null : (
          <div className="flex flex-wrap gap-2 px-1.5 pt-1.5">
            {pendingDiffCommentSummary === null ? null : (
              <div
                className="bg-muted flex items-center gap-2 rounded-full px-3 py-1 text-xs"
                title={pendingDiffCommentSummary.title}
              >
                <ChatCircleTextIcon aria-hidden="true" className="size-3.5" />
                <span>{pendingDiffCommentSummary.label}</span>
                <button
                  aria-label={`Remove all ${pendingDiffCommentSummary.label}`}
                  className="text-muted-foreground disabled:cursor-not-allowed"
                  disabled={isUploadingAttachments}
                  onClick={() => {
                    onClearPendingDiffComments();
                  }}
                  type="button"
                >
                  <XIcon aria-hidden="true" className="size-3.5" />
                </button>
              </div>
            )}
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
          className="min-h-12 resize-none border-0 bg-transparent p-1.5 text-sm shadow-none placeholder:text-muted-foreground/60 focus-visible:border-transparent focus-visible:ring-0"
          id="session-composer"
          onChange={(event) => {
            onComposerTextChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) {
              return;
            }

            event.preventDefault();
            if ((event.metaKey || event.ctrlKey) && onSecondarySubmit !== undefined) {
              if (secondarySubmitDisabled) {
                return;
              }

              onSecondarySubmit();
              return;
            }

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

          {keyboardShortcuts === undefined || keyboardShortcuts.length === 0 ? (
            <Button
              aria-label={submitLabel}
              className={[
                "shrink-0 rounded-full bg-transparent text-primary hover:bg-transparent",
                isSubmitPending ? "disabled:opacity-100" : null,
              ].join(" ")}
              disabled={submitDisabled}
              onClick={onSubmit}
              size="icon-fill"
              type="button"
              variant="ghost"
            >
              {composerActionIcon}
            </Button>
          ) : (
            <HoverCard>
              <HoverCardTrigger closeDelay={0} delay={0}>
                <Button
                  aria-label={submitLabel}
                  className={[
                    "shrink-0 rounded-full bg-transparent text-primary hover:bg-transparent",
                    isSubmitPending ? "disabled:opacity-100" : null,
                  ].join(" ")}
                  disabled={submitDisabled}
                  onClick={onSubmit}
                  size="icon-fill"
                  type="button"
                  variant="ghost"
                >
                  {composerActionIcon}
                </Button>
              </HoverCardTrigger>
              <HoverCardContent
                align="end"
                alignOffset={0}
                className="w-fit min-w-0 p-3"
                side="top"
                sideOffset={12}
              >
                <div className="space-y-1.5">
                  {keyboardShortcuts.map((shortcutHint) => (
                    <div
                      className="flex items-center justify-between gap-3 text-sm"
                      key={`${shortcutHint.action}:${shortcutHint.shortcut}`}
                    >
                      <span>{shortcutHint.action}</span>
                      <Kbd>{resolveShortcutDisplayLabel(shortcutHint.shortcut)}</Kbd>
                    </div>
                  ))}
                </div>
              </HoverCardContent>
            </HoverCard>
          )}
        </div>
      </div>
      {gitBranchLabel === null && pullRequest === null && contextUsage === null ? null : (
        <div className="text-muted-foreground flex items-center justify-between gap-4 px-1.5 pt-2 text-sm">
          <div className="flex min-w-0 items-center gap-4">
            {gitBranchLabel === null ? null : (
              <div
                className="flex min-w-0 items-center gap-1.5"
                data-repository-branch-state="present"
              >
                <GitBranchIcon aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate">{gitBranchLabel}</span>
              </div>
            )}
            {pullRequest === null ? null : (
              <TextLink
                className="min-w-0 items-center gap-1.5 [&_[data-icon=inline-end]]:translate-y-0"
                href={pullRequest.url}
                opensInNewWindow
                title={pullRequest.title}
                variant="subtle"
              >
                <GitPullRequestIcon aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate">
                  PR #{String(pullRequest.number)}
                  {pullRequest.isDraft ? " Draft" : ""}
                </span>
              </TextLink>
            )}
          </div>
          {contextUsage === null ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className="ml-auto flex shrink-0 cursor-default items-center gap-1.5 outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    tabIndex={0}
                  />
                }
              >
                <GaugeIcon aria-hidden="true" className="size-4" />
                <span>{contextUsage.label}</span>
              </TooltipTrigger>
              <TooltipContent side="top">{contextUsage.title}</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
