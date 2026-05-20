import type { ComposerCapability, ComposerCommandDescriptor } from "@mistle/integrations-core";
import {
  Button,
  ButtonGroup,
  DropdownMenuItem,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Kbd,
  MoreActionsMenu,
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
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  detectActiveComposerTrigger,
  listComposerCommands,
} from "../../pages/session-composer/session-composer-trigger-detection.js";
import { resolveSelectableValue } from "../../shared/select-value.js";
import {
  ContextMentionSearchMenu,
  type ContextMentionSearchMenuStatus,
  type ContextMentionSearchResult,
} from "./context-mention-search-menu.js";

function formatSlashCommandOptionLabel(command: ComposerCommandDescriptor): string {
  if (command.description === undefined) {
    return `/${command.name}`;
  }

  return `/${command.name} ${command.description}`;
}

function formatContextMentionInsertion(path: string): string {
  if (!/\s/.test(path)) {
    return `${path} `;
  }

  return `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}" `;
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

export type ChatComposerCommandPanel =
  | {
      kind: "confirm";
      title: string;
      description?: string;
      confirmLabel: string;
      cancelLabel: string;
      onConfirm: () => void;
      onCancel: () => void;
    }
  | {
      kind: "textInput";
      title: string;
      description?: string;
      initialValue: string;
      submitLabel: string;
      cancelLabel: string;
      onSubmit: (value: string) => void;
      onCancel: () => void;
    }
  | {
      kind: "choice";
      title: string;
      description?: string;
      suppressWhenQueuedPrompts?: boolean;
      choices: readonly {
        label: string;
        onSelect: () => void;
        variant?: "default" | "secondary" | "ghost";
      }[];
    }
  | {
      kind: "picker";
      title: string;
      searchPlaceholder: string;
      emptyLabel?: string;
      initialSearch?: string;
      onCancel: () => void;
      options: readonly {
        label: string;
        description?: string;
        onSelect: () => void;
      }[];
    };

export type ChatComposerContextMentionControl = {
  status: ContextMentionSearchMenuStatus;
  results: readonly ContextMentionSearchResult[];
  onQueryChange: (query: string) => void;
  onSelect: (input: { path: string; query: string }) => void;
  onDismiss: () => void;
};

export type ChatComposerViewModel = {
  composerCapabilities: readonly ComposerCapability[];
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
  goalStatus?: {
    label: string;
    title: string;
  } | null;
  collaborationModeStatus?: {
    label: string;
    title: string;
    onSwitchToDefault?: () => void;
  } | null;
  commandPanel?: ChatComposerCommandPanel | null;
  contextMentionControl?: ChatComposerContextMentionControl | null;
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
  reasoningEffortOptions: readonly {
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
  showConfigControls?: boolean;
  showReasoningControl?: boolean;
  onComposerTextChange: (value: string) => void;
  onSubmit: () => void;
  onRuntimeCommandSubmit: (commandId: string) => void;
  onSecondarySubmit?: () => void;
  onModelChange: (value: string) => void;
  onReasoningEffortChange: (value: string) => void;
  onPendingFilesAdded: (files: readonly File[]) => void;
  onClearPendingDiffComments: () => void;
  onRemovePendingAttachment: (attachmentId: string) => void;
};

type ChoiceCommandPanelChoice = Extract<
  ChatComposerCommandPanel,
  { kind: "choice" }
>["choices"][number];

function ChoiceCommandPanelActions(input: {
  choices: readonly ChoiceCommandPanelChoice[];
  title: string;
}): React.JSX.Element {
  const primaryChoice =
    input.choices.find((choice) => choice.variant === "default") ?? input.choices[0];
  const secondaryChoices = input.choices.filter((choice) => choice !== primaryChoice);

  if (primaryChoice === undefined) {
    return <></>;
  }

  if (secondaryChoices.length === 0) {
    return (
      <Button
        className="shrink-0"
        onClick={primaryChoice.onSelect}
        size="sm"
        type="button"
        variant={primaryChoice.variant ?? "secondary"}
      >
        {primaryChoice.label}
      </Button>
    );
  }

  return (
    <ButtonGroup aria-label={input.title} className="shrink-0">
      <Button onClick={primaryChoice.onSelect} size="sm" type="button" variant="default">
        {primaryChoice.label}
      </Button>
      <MoreActionsMenu
        contentClassName="w-56"
        sideOffset={6}
        triggerIconVariant="chevron-down"
        triggerLabel="More actions"
        triggerSize="icon-sm"
        triggerVariant="default"
      >
        {secondaryChoices.map((choice) => (
          <DropdownMenuItem key={choice.label} onClick={choice.onSelect}>
            {choice.label}
          </DropdownMenuItem>
        ))}
      </MoreActionsMenu>
    </ButtonGroup>
  );
}

export function ChatComposer({
  composerCapabilities,
  composerText,
  gitBranchLabel,
  pullRequest,
  contextUsage,
  goalStatus = null,
  collaborationModeStatus = null,
  commandPanel = null,
  contextMentionControl = null,
  pendingDiffCommentSummary,
  pendingAttachments,
  modelOptions,
  reasoningEffortOptions,
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
  showConfigControls = true,
  showReasoningControl = true,
  onComposerTextChange,
  onSubmit,
  onRuntimeCommandSubmit,
  onSecondarySubmit,
  onModelChange,
  onReasoningEffortChange,
  onPendingFilesAdded,
  onClearPendingDiffComments,
  onRemovePendingAttachment,
}: ChatComposerViewModel): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const commandPanelSearchInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const commandListId = useId();
  const contextMentionListId = useId();
  const commandPanelListId = useId();
  const [composerSelection, setComposerSelection] = useState({
    start: composerText.length,
    end: composerText.length,
  });
  const [activeSlashCommandIndex, setActiveSlashCommandIndex] = useState(0);
  const [activeContextMentionIndex, setActiveContextMentionIndex] = useState(0);
  const [dismissedContextMentionKey, setDismissedContextMentionKey] = useState<string | null>(null);
  const [activeCommandPanelOptionIndex, setActiveCommandPanelOptionIndex] = useState(0);
  const [commandPanelSearchText, setCommandPanelSearchText] = useState(
    commandPanel?.kind === "picker" ? (commandPanel.initialSearch ?? "") : "",
  );
  const [commandPanelText, setCommandPanelText] = useState(
    commandPanel?.kind === "textInput" ? commandPanel.initialValue : "",
  );
  useEffect(() => {
    if (commandPanel?.kind === "textInput") {
      setCommandPanelText(commandPanel.initialValue);
    }
  }, [commandPanel?.kind, commandPanel?.kind === "textInput" ? commandPanel.initialValue : null]);
  useEffect(() => {
    if (commandPanel?.kind !== "picker") {
      return;
    }

    setCommandPanelSearchText(commandPanel.initialSearch ?? "");
    setActiveCommandPanelOptionIndex(0);
    requestAnimationFrame(() => {
      commandPanelSearchInputRef.current?.focus();
    });
  }, [
    commandPanel?.kind,
    commandPanel?.kind === "picker" ? commandPanel.title : null,
    commandPanel?.kind === "picker" ? commandPanel.initialSearch : null,
  ]);
  const activeComposerTrigger = detectActiveComposerTrigger({
    composerCapabilities,
    composerText,
    selectionStart: composerSelection.start,
    selectionEnd: composerSelection.end,
  });
  const slashCommandOptions = useMemo(
    () => listComposerCommands(composerCapabilities),
    [composerCapabilities],
  );
  const filteredSlashCommandOptions =
    activeComposerTrigger === null || activeComposerTrigger.capabilityKind !== "composerCommand"
      ? []
      : slashCommandOptions.filter((command) =>
          command.name.startsWith(activeComposerTrigger.query),
        );
  const showSlashCommandMenu =
    activeComposerTrigger !== null && activeComposerTrigger.capabilityKind === "composerCommand";
  const activeSlashCommandIndexWithinBounds =
    filteredSlashCommandOptions.length === 0
      ? null
      : Math.min(activeSlashCommandIndex, filteredSlashCommandOptions.length - 1);
  const activeSlashCommand =
    activeSlashCommandIndexWithinBounds === null
      ? null
      : (filteredSlashCommandOptions[activeSlashCommandIndexWithinBounds] ?? null);
  const contextMentionResults = contextMentionControl?.results ?? [];
  const activeContextMentionKey =
    activeComposerTrigger?.capabilityKind === "contextMention"
      ? [
          String(activeComposerTrigger.range.start),
          String(activeComposerTrigger.range.end),
          activeComposerTrigger.query,
        ].join(":")
      : null;
  const isContextMentionDismissed =
    activeContextMentionKey !== null && activeContextMentionKey === dismissedContextMentionKey;
  const showContextMentionMenu =
    activeComposerTrigger !== null &&
    activeComposerTrigger.capabilityKind === "contextMention" &&
    contextMentionControl !== null &&
    !isContextMentionDismissed;
  const activeContextMentionIndexWithinBounds =
    contextMentionResults.length === 0
      ? null
      : Math.min(activeContextMentionIndex, contextMentionResults.length - 1);
  const activeContextMention =
    activeContextMentionIndexWithinBounds === null
      ? null
      : (contextMentionResults[activeContextMentionIndexWithinBounds] ?? null);
  const activeContextMentionQuery =
    activeComposerTrigger?.capabilityKind === "contextMention" ? activeComposerTrigger.query : null;
  const contextMentionOnDismiss = contextMentionControl?.onDismiss;
  const contextMentionOnQueryChange = contextMentionControl?.onQueryChange;
  const filteredCommandPanelOptions = useMemo(() => {
    if (commandPanel?.kind !== "picker") {
      return [];
    }

    const query = commandPanelSearchText.trim().toLowerCase();
    if (query.length === 0) {
      return commandPanel.options;
    }

    return commandPanel.options.filter((option) => {
      const searchableText = [option.label, option.description ?? ""].join(" ").toLowerCase();
      return searchableText.includes(query);
    });
  }, [commandPanel, commandPanelSearchText]);
  const activeCommandPanelOptionIndexWithinBounds =
    filteredCommandPanelOptions.length === 0
      ? null
      : Math.min(activeCommandPanelOptionIndex, filteredCommandPanelOptions.length - 1);
  const activeCommandPanelOption =
    activeCommandPanelOptionIndexWithinBounds === null
      ? null
      : (filteredCommandPanelOptions[activeCommandPanelOptionIndexWithinBounds] ?? null);
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
    optionValues: reasoningEffortOptions.map((option) => option.value),
  });
  const selectedReasoningEffortLabel = reasoningEffortOptions.find(
    (option) => option.value === selectedReasoningEffortValue,
  )?.label;

  useEffect(() => {
    if (activeContextMentionQuery === null) {
      setDismissedContextMentionKey(null);
      contextMentionOnDismiss?.();
      return;
    }

    if (isContextMentionDismissed) {
      return;
    }

    contextMentionOnQueryChange?.(activeContextMentionQuery);
  }, [
    activeContextMentionQuery,
    contextMentionOnDismiss,
    contextMentionOnQueryChange,
    isContextMentionDismissed,
  ]);

  useEffect(() => {
    if (!showContextMentionMenu || activeContextMentionIndexWithinBounds === null) {
      return;
    }

    document
      .getElementById(`${contextMentionListId}-${String(activeContextMentionIndexWithinBounds)}`)
      ?.scrollIntoView?.({
        block: "nearest",
      });
  }, [activeContextMentionIndexWithinBounds, contextMentionListId, showContextMentionMenu]);

  function addPendingFiles(files: readonly File[]): void {
    if (files.length === 0) {
      return;
    }

    onPendingFilesAdded(files);
  }

  function updateComposerSelection(textarea: HTMLTextAreaElement): void {
    setComposerSelection({
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    });
  }

  function insertSlashCommand(command: ComposerCommandDescriptor): void {
    if (
      activeComposerTrigger === null ||
      activeComposerTrigger.capabilityKind !== "composerCommand"
    ) {
      return;
    }

    const insertedText = `/${command.name} `;
    const nextComposerText = [
      composerText.slice(0, activeComposerTrigger.range.start),
      insertedText,
      composerText.slice(activeComposerTrigger.range.end),
    ].join("");
    const nextCursorIndex = activeComposerTrigger.range.start + insertedText.length;

    onComposerTextChange(nextComposerText);
    setComposerSelection({
      start: nextCursorIndex,
      end: nextCursorIndex,
    });
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursorIndex, nextCursorIndex);
    });
  }

  function insertContextMentionPath(path: string, query: string): void {
    if (
      activeComposerTrigger === null ||
      activeComposerTrigger.capabilityKind !== "contextMention"
    ) {
      return;
    }

    const insertedText = formatContextMentionInsertion(path);
    const nextComposerText = [
      composerText.slice(0, activeComposerTrigger.range.start),
      insertedText,
      composerText.slice(activeComposerTrigger.range.end),
    ].join("");
    const nextCursorIndex = activeComposerTrigger.range.start + insertedText.length;

    contextMentionControl?.onSelect({ path, query });
    onComposerTextChange(nextComposerText);
    setComposerSelection({
      start: nextCursorIndex,
      end: nextCursorIndex,
    });
    setActiveContextMentionIndex(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursorIndex, nextCursorIndex);
    });
  }

  function selectSlashCommand(command: ComposerCommandDescriptor): void {
    if (commandIsDisabledDuringActiveTurn(command)) {
      return;
    }

    if (command.submitAs === "runtimeCommand") {
      onRuntimeCommandSubmit(command.id);
      return;
    }

    insertSlashCommand(command);
  }

  function commandIsDisabledDuringActiveTurn(command: ComposerCommandDescriptor): boolean {
    return (
      (submitMode === "steer" || submitMode === "interrupt") &&
      command.availability?.duringActiveTurn === "disabled"
    );
  }

  function moveActiveSlashCommand(delta: number): void {
    if (filteredSlashCommandOptions.length === 0) {
      return;
    }

    setActiveSlashCommandIndex(
      (currentIndex) =>
        (currentIndex + delta + filteredSlashCommandOptions.length) %
        filteredSlashCommandOptions.length,
    );
  }

  function moveActiveContextMention(delta: number): void {
    if (contextMentionResults.length === 0) {
      return;
    }

    setActiveContextMentionIndex(
      (currentIndex) =>
        (currentIndex + delta + contextMentionResults.length) % contextMentionResults.length,
    );
  }

  function moveActiveCommandPanelOption(delta: number): void {
    if (filteredCommandPanelOptions.length === 0) {
      return;
    }

    setActiveCommandPanelOptionIndex(
      (currentIndex) =>
        (currentIndex + delta + filteredCommandPanelOptions.length) %
        filteredCommandPanelOptions.length,
    );
  }

  function selectActiveCommandPanelOption(): void {
    activeCommandPanelOption?.onSelect();
  }

  function renderCommandPanel(): React.JSX.Element | null {
    if (commandPanel === null) {
      return null;
    }

    if (commandPanel.kind === "picker") {
      return (
        <div className="mb-2 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md">
          <input
            aria-activedescendant={
              activeCommandPanelOptionIndexWithinBounds === null
                ? undefined
                : `${commandPanelListId}-option-${String(activeCommandPanelOptionIndexWithinBounds)}`
            }
            aria-controls={commandPanelListId}
            aria-expanded={true}
            aria-haspopup="listbox"
            aria-label={`${commandPanel.title} search`}
            className="h-9 w-full rounded-sm border-0 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground/70"
            onChange={(event) => {
              setCommandPanelSearchText(event.target.value);
              setActiveCommandPanelOptionIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveActiveCommandPanelOption(1);
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                moveActiveCommandPanelOption(-1);
                return;
              }

              if (event.key === "Enter") {
                event.preventDefault();
                selectActiveCommandPanelOption();
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                commandPanel.onCancel();
              }
            }}
            placeholder={commandPanel.searchPlaceholder}
            ref={commandPanelSearchInputRef}
            type="text"
            value={commandPanelSearchText}
          />
          <div
            aria-label={commandPanel.title}
            className="max-h-64 overflow-y-auto pt-1"
            id={commandPanelListId}
            role="listbox"
          >
            {filteredCommandPanelOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {commandPanel.emptyLabel ?? "No matching options"}
              </div>
            ) : (
              filteredCommandPanelOptions.map((option, optionIndex) => {
                const isActiveOption = option.label === activeCommandPanelOption?.label;

                return (
                  <button
                    aria-selected={isActiveOption}
                    className={[
                      "flex w-full flex-col rounded-sm px-3 py-2 text-left outline-none",
                      isActiveOption ? "bg-muted text-foreground" : "hover:bg-muted/70",
                    ].join(" ")}
                    id={`${commandPanelListId}-option-${String(optionIndex)}`}
                    key={option.label}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      option.onSelect();
                    }}
                    onMouseEnter={() => {
                      setActiveCommandPanelOptionIndex(optionIndex);
                    }}
                    role="option"
                    type="button"
                  >
                    <span>{option.label}</span>
                    {option.description === undefined ? null : (
                      <span className="text-sm text-muted-foreground">{option.description}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="mb-2 rounded-md border bg-card px-3 py-2 text-sm shadow-xs">
        {commandPanel.kind === "confirm" ? (
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="font-medium text-foreground">{commandPanel.title}</p>
              {commandPanel.description === undefined ? null : (
                <p className="text-muted-foreground">{commandPanel.description}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button onClick={commandPanel.onCancel} size="sm" type="button" variant="ghost">
                {commandPanel.cancelLabel}
              </Button>
              <Button onClick={commandPanel.onConfirm} size="sm" type="button">
                {commandPanel.confirmLabel}
              </Button>
            </div>
          </div>
        ) : commandPanel.kind === "textInput" ? (
          <div className="flex flex-col gap-2">
            <div>
              <p className="font-medium text-foreground">{commandPanel.title}</p>
              {commandPanel.description === undefined ? null : (
                <p className="text-muted-foreground">{commandPanel.description}</p>
              )}
            </div>
            <Textarea
              className="min-h-20 resize-none"
              onChange={(event) => {
                setCommandPanelText(event.target.value);
              }}
              value={commandPanelText}
            />
            <div className="flex justify-end gap-2">
              <Button onClick={commandPanel.onCancel} size="sm" type="button" variant="ghost">
                {commandPanel.cancelLabel}
              </Button>
              <Button
                onClick={() => {
                  commandPanel.onSubmit(commandPanelText);
                }}
                size="sm"
                type="button"
              >
                {commandPanel.submitLabel}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="font-medium text-foreground">{commandPanel.title}</p>
              {commandPanel.description === undefined ? null : (
                <p className="text-muted-foreground">{commandPanel.description}</p>
              )}
            </div>
            <ChoiceCommandPanelActions choices={commandPanel.choices} title={commandPanel.title} />
          </div>
        )}
      </div>
    );
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
      {renderCommandPanel()}
      <div className="bg-card flex flex-col gap-3 rounded-md border p-1.5 shadow-xs">
        <input
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
        <div className="relative">
          {showContextMentionMenu ? (
            <ContextMentionSearchMenu
              activePath={activeContextMention?.path ?? null}
              id={contextMentionListId}
              onResultMouseEnter={setActiveContextMentionIndex}
              onResultSelect={(result) => {
                insertContextMentionPath(result.path, activeContextMentionQuery ?? "");
              }}
              query={activeContextMentionQuery ?? ""}
              results={contextMentionResults}
              status={contextMentionControl?.status ?? "idle"}
            />
          ) : null}
          {showSlashCommandMenu ? (
            <div
              aria-label="Slash commands"
              className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              id={commandListId}
              role="listbox"
            >
              {filteredSlashCommandOptions.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">No commands</div>
              ) : (
                filteredSlashCommandOptions.map((command, commandIndex) => {
                  const isActiveCommand = command.id === activeSlashCommand?.id;
                  const isDisabledCommand = commandIsDisabledDuringActiveTurn(command);

                  return (
                    <button
                      aria-label={formatSlashCommandOptionLabel(command)}
                      aria-disabled={isDisabledCommand}
                      aria-selected={isActiveCommand}
                      className={[
                        "flex w-full items-start gap-3 rounded-sm px-3 py-2 text-left text-sm outline-none",
                        isActiveCommand ? "bg-muted text-foreground" : "hover:bg-muted/70",
                        isDisabledCommand ? "cursor-not-allowed opacity-50" : null,
                      ].join(" ")}
                      id={`${commandListId}-${command.id}`}
                      key={command.id}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        selectSlashCommand(command);
                      }}
                      onMouseEnter={() => {
                        setActiveSlashCommandIndex(commandIndex);
                      }}
                      role="option"
                      type="button"
                    >
                      <span className="min-w-24 font-mono text-xs text-muted-foreground">
                        /{command.name}
                      </span>
                      {command.description === undefined ? null : (
                        <span className="min-w-0 flex-1 text-muted-foreground">
                          {command.description}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          ) : null}
          <Textarea
            aria-activedescendant={
              showContextMentionMenu && activeContextMentionIndexWithinBounds !== null
                ? `${contextMentionListId}-${String(activeContextMentionIndexWithinBounds)}`
                : activeSlashCommand === null
                  ? undefined
                  : `${commandListId}-${activeSlashCommand.id}`
            }
            aria-controls={
              showContextMentionMenu
                ? contextMentionListId
                : showSlashCommandMenu
                  ? commandListId
                  : undefined
            }
            aria-expanded={showSlashCommandMenu || showContextMentionMenu}
            aria-haspopup="listbox"
            className="max-h-48 min-h-12 resize-none overflow-y-auto border-0 bg-transparent p-1.5 shadow-none placeholder:text-muted-foreground/60 focus-visible:border-transparent focus-visible:ring-0"
            id="session-composer"
            onChange={(event) => {
              onComposerTextChange(event.target.value);
              updateComposerSelection(event.currentTarget);
              setActiveSlashCommandIndex(0);
              setActiveContextMentionIndex(0);
              setDismissedContextMentionKey(null);
            }}
            onClick={(event) => {
              updateComposerSelection(event.currentTarget);
            }}
            onKeyDown={(event) => {
              if (showContextMentionMenu) {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDismissedContextMentionKey(activeContextMentionKey);
                  contextMentionControl?.onDismiss();
                  return;
                }

                if (contextMentionResults.length > 0) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveActiveContextMention(1);
                    return;
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveActiveContextMention(-1);
                    return;
                  }

                  if (event.key === "Tab" || event.key === "Enter") {
                    event.preventDefault();
                    if (activeContextMention !== null) {
                      insertContextMentionPath(
                        activeContextMention.path,
                        activeContextMentionQuery ?? "",
                      );
                    }
                    return;
                  }
                }
              }

              if (showSlashCommandMenu && filteredSlashCommandOptions.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveActiveSlashCommand(1);
                  return;
                }

                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveActiveSlashCommand(-1);
                  return;
                }

                if (event.key === "Tab" || event.key === "Enter") {
                  event.preventDefault();
                  if (activeSlashCommand !== null) {
                    selectSlashCommand(activeSlashCommand);
                  }
                  return;
                }
              }

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
            onKeyUp={(event) => {
              updateComposerSelection(event.currentTarget);
            }}
            onPaste={(event) => {
              const clipboardFiles = Array.from(event.clipboardData.files);
              if (clipboardFiles.length === 0) {
                return;
              }

              event.preventDefault();
              addPendingFiles(clipboardFiles);
            }}
            onSelect={(event) => {
              updateComposerSelection(event.currentTarget);
            }}
            placeholder={composerPlaceholder}
            ref={textareaRef}
            rows={2}
            value={composerText}
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5 md:flex md:flex-wrap md:items-center md:gap-2">
            <Button
              aria-label="Add files"
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

            {showConfigControls ? (
              <>
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

                {showReasoningControl ? (
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
                          : (selectedReasoningEffortLabel ?? selectedReasoningEffortValue)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {reasoningEffortOptions.map((reasoningOption) => (
                        <SelectItem key={reasoningOption.value} value={reasoningOption.value}>
                          {reasoningOption.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </>
            ) : null}
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
      {gitBranchLabel === null &&
      pullRequest === null &&
      contextUsage === null &&
      goalStatus === null &&
      collaborationModeStatus === null ? null : (
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
          <div className="ml-auto flex shrink-0 items-center gap-4">
            {collaborationModeStatus === null ? null : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      className="flex cursor-default items-center gap-1.5 rounded-sm outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      onClick={collaborationModeStatus.onSwitchToDefault}
                      type="button"
                    />
                  }
                >
                  <span>{collaborationModeStatus.label}</span>
                </TooltipTrigger>
                <TooltipContent side="top">{collaborationModeStatus.title}</TooltipContent>
              </Tooltip>
            )}
            {goalStatus === null ? null : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      className="flex cursor-default items-center gap-1.5 outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      tabIndex={0}
                    />
                  }
                >
                  <span>{goalStatus.label}</span>
                </TooltipTrigger>
                <TooltipContent side="top">{goalStatus.title}</TooltipContent>
              </Tooltip>
            )}
            {contextUsage === null ? null : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      className="flex cursor-default items-center gap-1.5 outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
        </div>
      )}
    </div>
  );
}
