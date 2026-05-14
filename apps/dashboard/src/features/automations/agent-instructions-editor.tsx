import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  closeCompletion,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type Extension, Prec } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  keymap,
  placeholder,
  tooltips,
  ViewPlugin,
  type ViewUpdate as CodeMirrorViewUpdate,
} from "@codemirror/view";
import { cn, textareaFieldShellClassName } from "@mistle/ui";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";

import {
  completeAgentInstructionToken,
  rankAgentInstructionTokensForMatching,
  resolveTemplateTokenContext,
} from "./agent-instructions-completion.js";
import type { AgentInstructionsEditorToken } from "./agent-instructions-token-catalog.js";

type AgentInstructionsEditorProps = {
  value: string;
  disabled: boolean;
  invalid: boolean;
  tokens: readonly AgentInstructionsEditorToken[];
  ariaLabelledBy: string;
  onChange: (value: string) => void;
  placeholderText?: string;
};

const TemplateTokenPattern = /\{\{([A-Za-z0-9_.]+)\}\}/g;

function resolveAgentInstructionsTooltipSpace(view: EditorView) {
  const documentElement = view.dom.ownerDocument.documentElement;

  return {
    left: 0,
    top: 0,
    right: documentElement.clientWidth,
    bottom: documentElement.clientHeight,
  };
}

function acceptCompletionOnTab(view: EditorView): boolean {
  if (completionStatus(view.state) === null) {
    return false;
  }

  return acceptCompletion(view);
}

function supportsDrawSelection(): boolean {
  if (typeof Range === "undefined") {
    return false;
  }

  return typeof Range.prototype.getClientRects === "function";
}

function createAgentInstructionsPlaceholder(
  view: EditorView,
  placeholderText: string,
): HTMLElement {
  const element = view.dom.ownerDocument.createElement("div");
  element.className =
    "m-0 whitespace-pre-wrap text-muted-foreground font-sans text-sm leading-[var(--text-sm--line-height)]";
  element.textContent = placeholderText;

  return element;
}

function createAgentInstructionsEditorTheme(): ReturnType<typeof EditorView.theme> {
  return EditorView.theme({
    "&": {
      backgroundColor: "transparent",
      fontSize: "var(--text-sm)",
    },
    ".cm-editor": {
      backgroundColor: "transparent",
      borderRadius: "inherit",
    },
    ".cm-scroller": {
      borderRadius: "inherit",
      fontFamily: "inherit",
      lineHeight: "var(--text-sm--line-height)",
      minHeight: "calc(var(--spacing) * 28)",
    },
    ".cm-content": {
      paddingBlock: "calc(var(--spacing) * 2)",
      paddingInline: "calc(var(--spacing) * 2.5)",
      minHeight: "calc(var(--spacing) * 28)",
      caretColor: "currentColor",
    },
    ".cm-line": {
      padding: "0",
    },
    ".cm-focused": {
      outline: "none",
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "color-mix(in oklch, var(--accent) 45%, transparent)",
    },
    ".cm-agent-token-valid": {
      color: "var(--agent-token-valid)",
    },
    ".cm-agent-token-invalid": {
      color: "var(--agent-token-invalid)",
    },
    ".cm-tooltip-autocomplete": {
      border: "1px solid var(--border)",
      backgroundColor: "var(--popover)",
      color: "var(--popover-foreground)",
      borderRadius: "var(--radius-md)",
      boxShadow: "var(--shadow-md)",
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-sm)",
      overflow: "hidden",
      minWidth: "20rem",
      maxWidth: "24rem",
      zIndex: "30",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": {
      fontFamily: "var(--font-sans)",
      maxHeight: "18rem",
      padding: "calc(var(--spacing) * 1)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
      display: "grid",
      gap: "calc(var(--spacing) * 0.25)",
      borderRadius: "var(--radius-sm)",
      borderLeft: "3px solid transparent",
      marginBlock: "calc(var(--spacing) * 0.25)",
      paddingBlock: "calc(var(--spacing) * 1.25)",
      paddingInline: "calc(var(--spacing) * 3)",
      transition: "background-color 120ms ease, color 120ms ease, border-color 120ms ease",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li:hover": {
      backgroundColor: "color-mix(in oklch, var(--accent) 55%, transparent)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--accent)",
      color: "var(--accent-foreground)",
      borderLeftColor: "var(--foreground)",
      boxShadow: "inset 0 0 0 1px var(--border)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] *": {
      color: "var(--accent-foreground)",
    },
    ".cm-completionLabel": {
      display: "block",
      fontFamily: "var(--font-sans)",
      fontWeight: "500",
      fontSize: "var(--text-sm)",
      lineHeight: "var(--text-sm--line-height)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    ".cm-completionDetail": {
      display: "block",
      color: "var(--muted-foreground)",
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-sm)",
      fontStyle: "normal",
      lineHeight: "var(--text-sm--line-height)",
      marginLeft: "0",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": {
      color: "color-mix(in oklch, var(--accent-foreground) 82%, transparent)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionMatchedText": {
      color: "var(--accent-foreground)",
      textDecorationColor: "color-mix(in oklch, var(--accent-foreground) 70%, transparent)",
    },
    ".cm-completionIcon": {
      display: "none",
    },
    ".cm-tooltip.cm-completionInfo": {
      border: "1px solid var(--border)",
      backgroundColor: "var(--popover)",
      color: "var(--popover-foreground)",
      borderRadius: "var(--radius-md)",
      boxShadow: "var(--shadow-md)",
      paddingBlock: "calc(var(--spacing) * 2)",
      paddingInline: "calc(var(--spacing) * 2.5)",
      fontFamily: "var(--font-sans)",
    },
  });
}

function createTemplateTokenHighlightExtension(
  tokens: readonly AgentInstructionsEditorToken[],
): Extension {
  const knownPaths = new Set(tokens.map((token) => token.path));

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildTemplateTokenDecorations(view, knownPaths);
      }

      update(update: CodeMirrorViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildTemplateTokenDecorations(update.view, knownPaths);
        }
      }
    },
    {
      decorations: (value) => value.decorations,
    },
  ).extension;
}

function buildTemplateTokenDecorations(
  view: EditorView,
  knownPaths: ReadonlySet<string>,
): DecorationSet {
  const ranges: ReturnType<ReturnType<typeof Decoration.mark>["range"]>[] = [];

  for (const { from, to } of view.visibleRanges) {
    const visibleText = view.state.doc.sliceString(from, to);
    TemplateTokenPattern.lastIndex = 0;

    let match: RegExpExecArray | null = TemplateTokenPattern.exec(visibleText);
    while (match !== null) {
      const fullMatch = match[0];
      const tokenPath = match[1] ?? "";
      const matchFrom = from + match.index;
      const matchTo = matchFrom + fullMatch.length;

      ranges.push(
        Decoration.mark({
          class: knownPaths.has(tokenPath) ? "cm-agent-token-valid" : "cm-agent-token-invalid",
        }).range(matchFrom, matchTo),
      );

      match = TemplateTokenPattern.exec(visibleText);
    }
  }

  return Decoration.set(ranges, true);
}

export function AgentInstructionsEditor(input: AgentInstructionsEditorProps): React.JSX.Element {
  const rankedTokens = useMemo(
    () => rankAgentInstructionTokensForMatching(input.tokens),
    [input.tokens],
  );
  const placeholderText = input.placeholderText;

  const extensions = useMemo(
    () => [
      history(),
      ...(supportsDrawSelection() ? [drawSelection()] : []),
      ...(placeholderText === undefined
        ? []
        : [placeholder((view) => createAgentInstructionsPlaceholder(view, placeholderText))]),
      EditorState.languageData.of(() => [
        {
          closeBrackets: {
            brackets: ["{"],
          },
        },
      ]),
      closeBrackets(),
      markdown(),
      EditorView.lineWrapping,
      tooltips({
        tooltipSpace: resolveAgentInstructionsTooltipSpace,
      }),
      createTemplateTokenHighlightExtension(rankedTokens),
      autocompletion({
        closeOnBlur: true,
        icons: false,
        override: [
          (context) =>
            completeAgentInstructionToken(context, {
              tokens: rankedTokens,
            }),
        ],
      }),
      Prec.highest(
        keymap.of([
          {
            key: "Escape",
            run: closeCompletion,
            preventDefault: true,
            stopPropagation: true,
          },
          {
            key: "Tab",
            run: acceptCompletionOnTab,
          },
        ]),
      ),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((update) => {
        if (input.disabled || !update.view.hasFocus) {
          return;
        }

        if (!update.docChanged && !update.selectionSet) {
          return;
        }

        const mainSelection = update.state.selection.main;
        if (!mainSelection.empty) {
          closeCompletion(update.view);
          return;
        }

        const templateQuery = resolveTemplateTokenContext({
          documentText: update.state.doc.toString(),
          cursorOffset: mainSelection.head,
        });
        const status = completionStatus(update.state);

        if (templateQuery === null) {
          if (status !== null) {
            closeCompletion(update.view);
          }
          return;
        }

        if (status === null) {
          startCompletion(update.view);
        }
      }),
      EditorView.editable.of(!input.disabled),
      EditorView.contentAttributes.of({
        "aria-labelledby": input.ariaLabelledBy,
        "aria-invalid": input.invalid ? "true" : "false",
        "aria-multiline": "true",
        ...(placeholderText === undefined ? {} : { "aria-placeholder": placeholderText }),
        role: "textbox",
      }),
      createAgentInstructionsEditorTheme(),
    ],
    [input.ariaLabelledBy, input.disabled, input.invalid, placeholderText, rankedTokens],
  );

  return (
    <div
      className="relative"
      data-editor-state={input.value.length === 0 ? "empty" : "filled"}
      data-slot="agent-instructions-editor"
    >
      <div
        aria-disabled={input.disabled ? "true" : "false"}
        aria-invalid={input.invalid ? "true" : "false"}
        className={cn(
          textareaFieldShellClassName({ focusMode: "focus-within" }),
          "overflow-hidden",
          input.disabled ? "cursor-not-allowed opacity-50" : null,
        )}
      >
        <CodeMirror
          basicSetup={false}
          editable={!input.disabled}
          extensions={extensions}
          onChange={(nextValue) => {
            input.onChange(nextValue);
          }}
          theme="none"
          value={input.value}
        />
      </div>
    </div>
  );
}
