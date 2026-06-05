import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type {
  ComposerCapability,
  ComposerCommandDescriptor,
  SkillMentionDescriptor,
} from "@mistle/integrations-core";
import { selectedSkillMentionMatchesText } from "@mistle/integrations-core";
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
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import type {
  ComposerDraft,
  SelectedSkillMention,
} from "../../pages/session-composer/session-composer-draft.js";
import {
  type ActiveComposerTrigger,
  detectActiveComposerTrigger,
  listComposerCommands,
  listSkillMentions,
} from "../../pages/session-composer/session-composer-trigger-detection.js";
import {
  CodeMirrorThemeValues,
  createCodeMirrorPlaceholder,
  createCodeMirrorTheme,
  getCodeMirrorDrawSelectionExtensions,
} from "../../shared/code-mirror-theme.js";
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

function formatSkillMentionOptionLabel(skill: SkillMentionDescriptor): string {
  if (skill.description === undefined) {
    return `$${skill.name}`;
  }

  return `$${skill.name} ${skill.description}`;
}

function formatSkillMentionSourceLabel(input: {
  skill: SkillMentionDescriptor;
  skills: readonly SkillMentionDescriptor[];
}): string {
  const duplicateSkills = input.skills.filter((skill) => skill.name === input.skill.name);
  const targetPathParts = getSkillMentionSourceLabelPathParts(input.skill);
  if (targetPathParts.length === 0) {
    return input.skill.sourcePath;
  }

  for (let suffixLength = 3; suffixLength <= targetPathParts.length; suffixLength += 1) {
    const targetLabel = targetPathParts.slice(-suffixLength).join("/");
    const hasCollision = duplicateSkills.some((skill) => {
      if (skill.sourcePath === input.skill.sourcePath) {
        return false;
      }

      return (
        getSkillMentionSourceLabelPathParts(skill).slice(-suffixLength).join("/") === targetLabel
      );
    });
    if (!hasCollision) {
      return targetLabel;
    }
  }

  return input.skill.sourcePath;
}

function getSkillMentionSourceLabelPathParts(skill: SkillMentionDescriptor): readonly string[] {
  return skill.sourcePath
    .split("/")
    .filter((pathPart) => pathPart.length > 0)
    .slice(0, -1);
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

function createComposerPlaceholder(view: EditorView, placeholderText: string): HTMLElement {
  return createCodeMirrorPlaceholder({
    className: "text-muted-foreground/60",
    text: placeholderText,
    view,
  });
}

function createComposerEditorTheme(): ReturnType<typeof EditorView.theme> {
  return createCodeMirrorTheme({
    root: {
      fontSize: "inherit",
    },
    scroller: {
      fontFamily: "inherit",
      lineHeight: "1.5rem",
      maxHeight: "calc(var(--spacing) * 48)",
      minHeight: "calc(var(--spacing) * 12)",
      overflowY: "auto",
    },
    content: {
      minHeight: "calc(var(--spacing) * 12)",
      padding: "calc(var(--spacing) * 1.5)",
    },
    rules: {
      ".cm-selected-skill-mention": {
        color: "var(--color-blue-700)",
        fontWeight: "var(--font-weight-medium)",
      },
    },
  });
}

function createSelectedSkillMentionDecorations(
  selectedSkillMentions: readonly SelectedSkillMention[],
): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor() {
        this.decorations = buildSelectedSkillMentionDecorations(selectedSkillMentions);
      }

      update() {
        this.decorations = buildSelectedSkillMentionDecorations(selectedSkillMentions);
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

function buildSelectedSkillMentionDecorations(
  selectedSkillMentions: readonly SelectedSkillMention[],
): DecorationSet {
  return Decoration.set(
    selectedSkillMentions
      .map((mention) =>
        Decoration.mark({
          class: "cm-selected-skill-mention",
          attributes: {
            title: mention.sourcePath,
          },
        }).range(mention.range.start, mention.range.end),
      )
      .sort((left, right) => left.from - right.from),
  );
}

function insertComposerLineBreak(view: EditorView): boolean {
  view.dispatch(view.state.replaceSelection("\n"));

  return true;
}

function mapSelectedSkillMentionRanges(input: {
  selectedSkillMentions: readonly SelectedSkillMention[];
  text: string;
  update: ViewUpdate;
}): readonly SelectedSkillMention[] {
  return input.selectedSkillMentions.flatMap((mention) => {
    const start = input.update.changes.mapPos(mention.range.start, 1);
    const end = input.update.changes.mapPos(mention.range.end, -1);
    if (start >= end) {
      return [];
    }

    const nextMention = {
      ...mention,
      range: {
        start,
        end,
      },
    };

    if (!selectedSkillMentionMatchesText({ mention: nextMention, text: input.text })) {
      return [];
    }

    return [nextMention];
  });
}

function updateSelectedSkillMentionsForTextReplacement(input: {
  insertedText: string;
  range: { start: number; end: number };
  selectedSkillMentions: readonly SelectedSkillMention[];
  text: string;
}): readonly SelectedSkillMention[] {
  const replacedLength = input.range.end - input.range.start;
  const delta = input.insertedText.length - replacedLength;

  return input.selectedSkillMentions.flatMap((mention) => {
    if (mention.range.end <= input.range.start) {
      return [mention];
    }

    if (mention.range.start >= input.range.end) {
      const nextMention = {
        ...mention,
        range: {
          start: mention.range.start + delta,
          end: mention.range.end + delta,
        },
      };

      return selectedSkillMentionMatchesText({
        mention: nextMention,
        text: input.text,
      })
        ? [nextMention]
        : [];
    }

    return [];
  });
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
  composerDraft: ComposerDraft;
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
  onComposerDraftChange: (value: ComposerDraft) => void;
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

type SlashPaletteOption =
  | {
      kind: "command";
      command: ComposerCommandDescriptor;
    }
  | {
      kind: "skill";
      skill: SkillMentionDescriptor;
    };

function createCommandSlashPaletteOption(command: ComposerCommandDescriptor): SlashPaletteOption {
  return {
    kind: "command",
    command,
  };
}

function createSkillSlashPaletteOption(skill: SkillMentionDescriptor): SlashPaletteOption {
  return {
    kind: "skill",
    skill,
  };
}

function SkillMentionOptionButton(input: {
  id: string;
  isActive: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
  showSourceLabel: boolean;
  skill: SkillMentionDescriptor;
  skills: readonly SkillMentionDescriptor[];
}): React.JSX.Element {
  const sourceLabel = formatSkillMentionSourceLabel({ skill: input.skill, skills: input.skills });
  const optionLabel = input.showSourceLabel
    ? `$${input.skill.name} ${sourceLabel}`
    : formatSkillMentionOptionLabel(input.skill);

  return (
    <button
      aria-label={optionLabel}
      aria-selected={input.isActive}
      className={[
        "flex w-full items-start gap-3 rounded-sm px-3 py-2 text-left text-sm outline-none",
        input.isActive ? "bg-muted text-foreground" : "hover:bg-muted/70",
      ].join(" ")}
      id={input.id}
      onMouseDown={(event) => {
        event.preventDefault();
        input.onSelect();
      }}
      onMouseEnter={input.onMouseEnter}
      role="option"
      type="button"
    >
      <span className="min-w-24 font-mono text-xs text-muted-foreground">${input.skill.name}</span>
      {input.showSourceLabel ? (
        <span className="min-w-0 flex-1 text-muted-foreground" title={input.skill.sourcePath}>
          {sourceLabel}
        </span>
      ) : input.skill.description === undefined ? null : (
        <span className="min-w-0 flex-1 text-muted-foreground">{input.skill.description}</span>
      )}
    </button>
  );
}

function hasDuplicateSkillMentionName(input: {
  skill: SkillMentionDescriptor;
  skills: readonly SkillMentionDescriptor[];
}): boolean {
  return input.skills.some((skill) => skill !== input.skill && skill.name === input.skill.name);
}

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
  composerDraft,
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
  onComposerDraftChange,
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
  const editorViewRef = useRef<EditorView | null>(null);
  const commandListId = useId();
  const contextMentionListId = useId();
  const commandPanelListId = useId();
  const [composerSelection, setComposerSelection] = useState({
    start: composerDraft.text.length,
    end: composerDraft.text.length,
  });
  const [activeSlashCommandIndex, setActiveSlashCommandIndex] = useState(0);
  const [activeSkillMentionIndex, setActiveSkillMentionIndex] = useState(0);
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
    composerText: composerDraft.text,
    selectionStart: composerSelection.start,
    selectionEnd: composerSelection.end,
  });
  const slashCommandOptions = useMemo(
    () => listComposerCommands(composerCapabilities),
    [composerCapabilities],
  );
  const skillMentionOptions = useMemo(
    () => listSkillMentions(composerCapabilities),
    [composerCapabilities],
  );
  const filteredSlashCommandOptions =
    activeComposerTrigger === null || activeComposerTrigger.capabilityKind !== "composerCommand"
      ? []
      : slashCommandOptions.filter(
          (command) =>
            (activeComposerTrigger.range.start === 0 || command.submitAs === "inlineText") &&
            command.name.startsWith(activeComposerTrigger.query),
        );
  const filteredSlashSkillOptions =
    activeComposerTrigger === null || activeComposerTrigger.capabilityKind !== "composerCommand"
      ? []
      : skillMentionOptions.filter((skill) => skill.name.startsWith(activeComposerTrigger.query));
  const slashPaletteOptions = useMemo<readonly SlashPaletteOption[]>(
    () => [
      ...filteredSlashCommandOptions.map(createCommandSlashPaletteOption),
      ...filteredSlashSkillOptions.map(createSkillSlashPaletteOption),
    ],
    [filteredSlashCommandOptions, filteredSlashSkillOptions],
  );
  const showSlashCommandMenu =
    activeComposerTrigger !== null && activeComposerTrigger.capabilityKind === "composerCommand";
  const activeSlashCommandKey =
    activeComposerTrigger?.capabilityKind === "composerCommand"
      ? [
          String(activeComposerTrigger.range.start),
          String(activeComposerTrigger.range.end),
          activeComposerTrigger.query,
        ].join(":")
      : null;
  const activeSlashCommandIndexWithinBounds =
    slashPaletteOptions.length === 0
      ? null
      : Math.min(activeSlashCommandIndex, slashPaletteOptions.length - 1);
  const activeSlashPaletteOption =
    activeSlashCommandIndexWithinBounds === null
      ? null
      : (slashPaletteOptions[activeSlashCommandIndexWithinBounds] ?? null);
  const activeSkillMentionQuery =
    activeComposerTrigger?.capabilityKind === "skillMention" ? activeComposerTrigger.query : null;
  const filteredSkillMentionOptions =
    activeSkillMentionQuery === null
      ? []
      : skillMentionOptions.filter((skill) => skill.name.startsWith(activeSkillMentionQuery));
  const showSkillMentionMenu =
    activeComposerTrigger !== null && activeComposerTrigger.capabilityKind === "skillMention";
  const activeSkillMentionKey =
    activeComposerTrigger?.capabilityKind === "skillMention"
      ? [
          String(activeComposerTrigger.range.start),
          String(activeComposerTrigger.range.end),
          activeComposerTrigger.query,
        ].join(":")
      : null;
  const activeSkillMentionIndexWithinBounds =
    filteredSkillMentionOptions.length === 0
      ? null
      : Math.min(activeSkillMentionIndex, filteredSkillMentionOptions.length - 1);
  const activeSkillMention =
    activeSkillMentionIndexWithinBounds === null
      ? null
      : (filteredSkillMentionOptions[activeSkillMentionIndexWithinBounds] ?? null);
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
    setActiveSlashCommandIndex(0);
  }, [activeSlashCommandKey]);

  useEffect(() => {
    setActiveSkillMentionIndex(0);
  }, [activeSkillMentionKey]);

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

  function updateComposerSelectionFromView(view: EditorView): void {
    const selection = view.state.selection.main;
    setComposerSelection((currentSelection) => {
      if (currentSelection.start === selection.from && currentSelection.end === selection.to) {
        return currentSelection;
      }

      return {
        start: selection.from,
        end: selection.to,
      };
    });
  }

  function readLiveComposerState(): {
    text: string;
    selectionStart: number;
    selectionEnd: number;
  } {
    const editorView = editorViewRef.current;
    if (editorView === null) {
      return {
        text: composerDraft.text,
        selectionStart: composerSelection.start,
        selectionEnd: composerSelection.end,
      };
    }

    const selection = editorView.state.selection.main;
    return {
      text: editorView.state.doc.toString(),
      selectionStart: selection.from,
      selectionEnd: selection.to,
    };
  }

  function detectLiveActiveComposerTrigger(): ActiveComposerTrigger | null {
    const liveState = readLiveComposerState();
    return detectActiveComposerTrigger({
      composerCapabilities,
      composerText: liveState.text,
      selectionStart: liveState.selectionStart,
      selectionEnd: liveState.selectionEnd,
    });
  }

  function focusEditorAtPosition(cursorIndex: number): void {
    requestAnimationFrame(() => {
      const editorView = editorViewRef.current;
      if (editorView === null) {
        return;
      }

      const boundedCursorIndex = Math.min(cursorIndex, editorView.state.doc.length);
      editorView.focus();
      editorView.dispatch({
        selection: {
          anchor: boundedCursorIndex,
        },
      });
    });
  }

  function replaceActiveTriggerRange(input: {
    insertedText: string;
    trigger?: ActiveComposerTrigger | null;
    selectedSkillMentions?: readonly SelectedSkillMention[];
  }): void {
    const trigger = input.trigger ?? activeComposerTrigger;
    if (trigger === null) {
      return;
    }

    const liveState = readLiveComposerState();
    const nextComposerText = [
      liveState.text.slice(0, trigger.range.start),
      input.insertedText,
      liveState.text.slice(trigger.range.end),
    ].join("");
    const nextCursorIndex = trigger.range.start + input.insertedText.length;
    const selectedSkillMentions =
      input.selectedSkillMentions ??
      updateSelectedSkillMentionsForTextReplacement({
        insertedText: input.insertedText,
        range: trigger.range,
        selectedSkillMentions: composerDraft.selectedSkillMentions,
        text: nextComposerText,
      });

    editorViewRef.current?.dispatch({
      changes: {
        from: trigger.range.start,
        to: trigger.range.end,
        insert: input.insertedText,
      },
      selection: {
        anchor: nextCursorIndex,
      },
    });

    onComposerDraftChange({
      text: nextComposerText,
      selectedSkillMentions,
    });
    setComposerSelection({
      start: nextCursorIndex,
      end: nextCursorIndex,
    });
    focusEditorAtPosition(nextCursorIndex);
  }

  function insertSlashCommand(
    command: ComposerCommandDescriptor,
    trigger: ActiveComposerTrigger | null = activeComposerTrigger,
  ): void {
    if (trigger === null || trigger.capabilityKind !== "composerCommand") {
      return;
    }

    replaceActiveTriggerRange({
      insertedText: `/${command.name} `,
      trigger,
    });
  }

  function insertSkillMention(
    skill: SkillMentionDescriptor,
    trigger: ActiveComposerTrigger | null = activeComposerTrigger,
  ): void {
    if (
      trigger === null ||
      (trigger.capabilityKind !== "composerCommand" && trigger.capabilityKind !== "skillMention")
    ) {
      return;
    }

    const insertedText = `$${skill.name} `;
    const selectedRange = {
      start: trigger.range.start,
      end: trigger.range.start + insertedText.length - 1,
    };
    const liveState = readLiveComposerState();
    const nextComposerText = [
      liveState.text.slice(0, trigger.range.start),
      insertedText,
      liveState.text.slice(trigger.range.end),
    ].join("");
    const nextCursorIndex = trigger.range.start + insertedText.length;
    const selectedSkillMentions = [
      ...updateSelectedSkillMentionsForTextReplacement({
        insertedText,
        range: trigger.range,
        selectedSkillMentions: composerDraft.selectedSkillMentions,
        text: nextComposerText,
      }),
      {
        name: skill.name,
        sourcePath: skill.sourcePath,
        range: selectedRange,
      },
    ];

    editorViewRef.current?.dispatch({
      changes: {
        from: trigger.range.start,
        to: trigger.range.end,
        insert: insertedText,
      },
      selection: {
        anchor: nextCursorIndex,
      },
    });

    onComposerDraftChange({
      text: nextComposerText,
      selectedSkillMentions,
    });
    setComposerSelection({
      start: nextCursorIndex,
      end: nextCursorIndex,
    });
    setActiveSlashCommandIndex(0);
    setActiveSkillMentionIndex(0);
    focusEditorAtPosition(nextCursorIndex);
  }

  function insertContextMentionPath(
    path: string,
    query: string,
    trigger: ActiveComposerTrigger | null = activeComposerTrigger,
  ): void {
    if (trigger === null || trigger.capabilityKind !== "contextMention") {
      return;
    }

    const insertedText = formatContextMentionInsertion(path);
    const liveState = readLiveComposerState();
    const nextComposerText = [
      liveState.text.slice(0, trigger.range.start),
      insertedText,
      liveState.text.slice(trigger.range.end),
    ].join("");
    const nextCursorIndex = trigger.range.start + insertedText.length;

    contextMentionControl?.onSelect({ path, query });
    editorViewRef.current?.dispatch({
      changes: {
        from: trigger.range.start,
        to: trigger.range.end,
        insert: insertedText,
      },
      selection: {
        anchor: nextCursorIndex,
      },
    });
    onComposerDraftChange({
      text: nextComposerText,
      selectedSkillMentions: updateSelectedSkillMentionsForTextReplacement({
        insertedText,
        range: trigger.range,
        selectedSkillMentions: composerDraft.selectedSkillMentions,
        text: nextComposerText,
      }),
    });
    setComposerSelection({
      start: nextCursorIndex,
      end: nextCursorIndex,
    });
    setActiveContextMentionIndex(0);
    focusEditorAtPosition(nextCursorIndex);
  }

  function selectSlashCommand(
    command: ComposerCommandDescriptor,
    trigger: ActiveComposerTrigger | null = activeComposerTrigger,
  ): void {
    if (commandIsDisabledDuringActiveTurn(command)) {
      return;
    }

    if (command.submitAs === "runtimeCommand") {
      onRuntimeCommandSubmit(command.id);
      return;
    }

    insertSlashCommand(command, trigger);
  }

  function selectSlashPaletteOption(
    option: SlashPaletteOption,
    trigger: ActiveComposerTrigger | null = activeComposerTrigger,
  ): void {
    if (option.kind === "command") {
      selectSlashCommand(option.command, trigger);
      return;
    }

    insertSkillMention(option.skill, trigger);
  }

  function commandIsDisabledDuringActiveTurn(command: ComposerCommandDescriptor): boolean {
    return (
      (submitMode === "steer" || submitMode === "interrupt") &&
      command.availability?.duringActiveTurn === "disabled"
    );
  }

  function moveActiveSlashCommand(delta: number): void {
    if (slashPaletteOptions.length === 0) {
      return;
    }

    setActiveSlashCommandIndex(
      (currentIndex) =>
        (currentIndex + delta + slashPaletteOptions.length) % slashPaletteOptions.length,
    );
  }

  function moveActiveSkillMention(delta: number): void {
    if (filteredSkillMentionOptions.length === 0) {
      return;
    }

    setActiveSkillMentionIndex(
      (currentIndex) =>
        (currentIndex + delta + filteredSkillMentionOptions.length) %
        filteredSkillMentionOptions.length,
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

  function handleComposerEditorCommand(input: {
    key: string;
    isModEnter?: boolean;
    skipSubmit?: boolean;
  }): boolean {
    const liveComposerTrigger = detectLiveActiveComposerTrigger();
    const liveContextMentionKey =
      liveComposerTrigger?.capabilityKind === "contextMention"
        ? [
            String(liveComposerTrigger.range.start),
            String(liveComposerTrigger.range.end),
            liveComposerTrigger.query,
          ].join(":")
        : null;
    const liveShowContextMentionMenu =
      liveComposerTrigger !== null &&
      liveComposerTrigger.capabilityKind === "contextMention" &&
      contextMentionControl !== null &&
      liveContextMentionKey !== dismissedContextMentionKey;
    const liveSlashPaletteOptions =
      liveComposerTrigger === null || liveComposerTrigger.capabilityKind !== "composerCommand"
        ? []
        : [
            ...slashCommandOptions
              .filter(
                (command) =>
                  (liveComposerTrigger.range.start === 0 || command.submitAs === "inlineText") &&
                  command.name.startsWith(liveComposerTrigger.query),
              )
              .map(createCommandSlashPaletteOption),
            ...skillMentionOptions
              .filter((skill) => skill.name.startsWith(liveComposerTrigger.query))
              .map(createSkillSlashPaletteOption),
          ];
    const liveShowSlashCommandMenu =
      liveComposerTrigger !== null && liveComposerTrigger.capabilityKind === "composerCommand";
    const liveActiveSlashPaletteOption =
      liveSlashPaletteOptions.length === 0
        ? null
        : (liveSlashPaletteOptions[
            Math.min(activeSlashCommandIndex, liveSlashPaletteOptions.length - 1)
          ] ?? null);
    const liveFilteredSkillMentionOptions =
      liveComposerTrigger === null || liveComposerTrigger.capabilityKind !== "skillMention"
        ? []
        : skillMentionOptions.filter((skill) => skill.name.startsWith(liveComposerTrigger.query));
    const liveShowSkillMentionMenu =
      liveComposerTrigger !== null && liveComposerTrigger.capabilityKind === "skillMention";
    const liveActiveSkillMention =
      liveFilteredSkillMentionOptions.length === 0
        ? null
        : (liveFilteredSkillMentionOptions[
            Math.min(activeSkillMentionIndex, liveFilteredSkillMentionOptions.length - 1)
          ] ?? null);

    if (liveShowContextMentionMenu) {
      if (input.key === "Escape") {
        setDismissedContextMentionKey(liveContextMentionKey);
        contextMentionControl?.onDismiss();
        return true;
      }

      if (contextMentionResults.length > 0) {
        if (input.key === "ArrowDown") {
          moveActiveContextMention(1);
          return true;
        }

        if (input.key === "ArrowUp") {
          moveActiveContextMention(-1);
          return true;
        }

        if (input.key === "Tab" || input.key === "Enter") {
          if (activeContextMention !== null) {
            insertContextMentionPath(
              activeContextMention.path,
              liveComposerTrigger?.query ?? "",
              liveComposerTrigger,
            );
          }
          return true;
        }
      }
    }

    if (liveShowSlashCommandMenu && liveSlashPaletteOptions.length > 0) {
      if (input.key === "ArrowDown") {
        moveActiveSlashCommand(1);
        return true;
      }

      if (input.key === "ArrowUp") {
        moveActiveSlashCommand(-1);
        return true;
      }

      if (input.key === "Tab" || input.key === "Enter") {
        if (liveActiveSlashPaletteOption !== null) {
          selectSlashPaletteOption(liveActiveSlashPaletteOption, liveComposerTrigger);
        }
        return true;
      }
    }

    if (liveShowSkillMentionMenu && liveFilteredSkillMentionOptions.length > 0) {
      if (input.key === "ArrowDown") {
        moveActiveSkillMention(1);
        return true;
      }

      if (input.key === "ArrowUp") {
        moveActiveSkillMention(-1);
        return true;
      }

      if (input.key === "Tab" || input.key === "Enter") {
        if (liveActiveSkillMention !== null) {
          insertSkillMention(liveActiveSkillMention, liveComposerTrigger);
        }
        return true;
      }
    }

    if (input.key !== "Enter") {
      return false;
    }

    if (input.skipSubmit === true) {
      return false;
    }

    if (input.isModEnter === true && onSecondarySubmit !== undefined) {
      if (!secondarySubmitDisabled) {
        onSecondarySubmit();
      }
      return true;
    }

    if (!submitDisabled) {
      onSubmit();
    }
    return true;
  }

  const composerEditorExtensions = useMemo(() => {
    const contentAttributes: Record<string, string> = {
      "aria-expanded": String(
        showSlashCommandMenu || showSkillMentionMenu || showContextMentionMenu,
      ),
      "aria-haspopup": "listbox",
      "aria-multiline": "true",
      "aria-placeholder": composerPlaceholder,
      id: "session-composer",
      role: "textbox",
    };
    const activeDescendant =
      showContextMentionMenu && activeContextMentionIndexWithinBounds !== null
        ? `${contextMentionListId}-${String(activeContextMentionIndexWithinBounds)}`
        : showSlashCommandMenu && activeSlashPaletteOption !== null
          ? activeSlashPaletteOption.kind === "command"
            ? `${commandListId}-command-${activeSlashPaletteOption.command.id}`
            : `${commandListId}-skill-${activeSlashPaletteOption.skill.sourcePath}`
          : showSkillMentionMenu && activeSkillMention !== null
            ? `${commandListId}-skill-${activeSkillMention.sourcePath}`
            : null;
    if (activeDescendant !== null) {
      contentAttributes["aria-activedescendant"] = activeDescendant;
    }

    const ariaControls = showContextMentionMenu
      ? contextMentionListId
      : showSlashCommandMenu || showSkillMentionMenu
        ? commandListId
        : null;
    if (ariaControls !== null) {
      contentAttributes["aria-controls"] = ariaControls;
    }

    return [
      history(),
      ...getCodeMirrorDrawSelectionExtensions(),
      placeholder((view) => createComposerPlaceholder(view, composerPlaceholder)),
      EditorView.lineWrapping,
      EditorView.domEventHandlers({
        keydown: (event, view) => {
          if (event.key !== "Enter" || !event.shiftKey || event.metaKey || event.ctrlKey) {
            return false;
          }

          event.preventDefault();
          return insertComposerLineBreak(view);
        },
        paste: (event) => {
          const clipboardFiles = Array.from(event.clipboardData?.files ?? []);
          if (clipboardFiles.length === 0) {
            return false;
          }

          event.preventDefault();
          addPendingFiles(clipboardFiles);
          return true;
        },
      }),
      EditorView.updateListener.of((update) => {
        editorViewRef.current = update.view;
        updateComposerSelectionFromView(update.view);
      }),
      EditorView.contentAttributes.of(contentAttributes),
      createSelectedSkillMentionDecorations(composerDraft.selectedSkillMentions),
      Prec.highest(
        keymap.of([
          {
            key: "ArrowDown",
            run: () => handleComposerEditorCommand({ key: "ArrowDown" }),
          },
          {
            key: "ArrowUp",
            run: () => handleComposerEditorCommand({ key: "ArrowUp" }),
          },
          {
            key: "Escape",
            run: () => handleComposerEditorCommand({ key: "Escape" }),
          },
          {
            key: "Tab",
            run: () => handleComposerEditorCommand({ key: "Tab" }),
          },
          {
            key: "Enter",
            run: () => handleComposerEditorCommand({ key: "Enter" }),
          },
          {
            key: "Mod-Enter",
            run: () => handleComposerEditorCommand({ key: "Enter", isModEnter: true }),
          },
        ]),
      ),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      createComposerEditorTheme(),
    ] satisfies Extension[];
  }, [
    activeContextMention,
    activeContextMentionIndexWithinBounds,
    activeContextMentionKey,
    activeContextMentionQuery,
    activeSlashPaletteOption,
    activeSkillMention,
    commandListId,
    composerDraft.selectedSkillMentions,
    composerPlaceholder,
    contextMentionControl,
    contextMentionListId,
    contextMentionResults,
    filteredSkillMentionOptions.length,
    onSecondarySubmit,
    secondarySubmitDisabled,
    showContextMentionMenu,
    showSkillMentionMenu,
    showSlashCommandMenu,
    slashPaletteOptions.length,
    submitDisabled,
    onSubmit,
  ]);

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
        <div
          className="relative"
          onKeyDownCapture={(event) => {
            if (event.key === "Enter" && event.shiftKey && !event.metaKey && !event.ctrlKey) {
              const handled = handleComposerEditorCommand({
                key: "Enter",
                skipSubmit: true,
              });
              if (handled) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }

              const editorView = editorViewRef.current;
              if (editorView !== null) {
                event.preventDefault();
                event.stopPropagation();
                insertComposerLineBreak(editorView);
              }
              return;
            }

            const handled = handleComposerEditorCommand({
              key: event.key,
              isModEnter: event.key === "Enter" && (event.metaKey || event.ctrlKey),
            });
            if (!handled) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
          }}
        >
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
              {slashPaletteOptions.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">No commands</div>
              ) : (
                <>
                  {filteredSlashCommandOptions.length === 0 ? null : (
                    <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                      Commands
                    </div>
                  )}
                  {filteredSlashCommandOptions.map((command, commandIndex) => {
                    const isActiveCommand =
                      activeSlashPaletteOption?.kind === "command" &&
                      activeSlashPaletteOption.command.id === command.id;
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
                        id={`${commandListId}-command-${command.id}`}
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
                  })}
                  {filteredSlashSkillOptions.length === 0 ? null : (
                    <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                      Skills
                    </div>
                  )}
                  {filteredSlashSkillOptions.map((skill, skillIndex) => {
                    const optionIndex = filteredSlashCommandOptions.length + skillIndex;
                    const isActiveSkill =
                      activeSlashPaletteOption?.kind === "skill" &&
                      activeSlashPaletteOption.skill.sourcePath === skill.sourcePath;

                    return (
                      <SkillMentionOptionButton
                        id={`${commandListId}-skill-${skill.sourcePath}`}
                        key={skill.sourcePath}
                        onMouseEnter={() => {
                          setActiveSlashCommandIndex(optionIndex);
                        }}
                        onSelect={() => {
                          insertSkillMention(skill);
                        }}
                        isActive={isActiveSkill}
                        showSourceLabel={hasDuplicateSkillMentionName({
                          skill,
                          skills: skillMentionOptions,
                        })}
                        skill={skill}
                        skills={skillMentionOptions}
                      />
                    );
                  })}
                </>
              )}
            </div>
          ) : null}
          {showSkillMentionMenu ? (
            <div
              aria-label="Skills"
              className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              id={commandListId}
              role="listbox"
            >
              {filteredSkillMentionOptions.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">No skills</div>
              ) : (
                filteredSkillMentionOptions.map((skill, skillIndex) => {
                  const isActiveSkill = skill.sourcePath === activeSkillMention?.sourcePath;

                  return (
                    <SkillMentionOptionButton
                      id={`${commandListId}-skill-${skill.sourcePath}`}
                      key={skill.sourcePath}
                      onMouseEnter={() => {
                        setActiveSkillMentionIndex(skillIndex);
                      }}
                      onSelect={() => {
                        insertSkillMention(skill);
                      }}
                      isActive={isActiveSkill}
                      showSourceLabel={hasDuplicateSkillMentionName({
                        skill,
                        skills: skillMentionOptions,
                      })}
                      skill={skill}
                      skills={skillMentionOptions}
                    />
                  );
                })
              )}
            </div>
          ) : null}
          <CodeMirror
            basicSetup={false}
            className={CodeMirrorThemeValues.PROSE_TEXT_CLASS_NAME}
            editable
            extensions={composerEditorExtensions}
            onChange={(nextText: string, viewUpdate: ViewUpdate) => {
              const selectedSkillMentions = viewUpdate.docChanged
                ? mapSelectedSkillMentionRanges({
                    selectedSkillMentions: composerDraft.selectedSkillMentions,
                    text: nextText,
                    update: viewUpdate,
                  })
                : composerDraft.selectedSkillMentions;

              onComposerDraftChange({
                text: nextText,
                selectedSkillMentions,
              });
              updateComposerSelectionFromView(viewUpdate.view);
              setActiveSlashCommandIndex(0);
              setActiveSkillMentionIndex(0);
              setActiveContextMentionIndex(0);
              setDismissedContextMentionKey(null);
            }}
            onCreateEditor={(view: EditorView) => {
              editorViewRef.current = view;
              const endPosition = view.state.doc.length;
              view.dispatch({
                selection: {
                  anchor: endPosition,
                },
              });
            }}
            theme="none"
            value={composerDraft.text}
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
