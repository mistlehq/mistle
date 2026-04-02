import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Prec } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { cn } from "@mistle/ui";
import type { EditorView as CodeMirrorEditorView, ViewUpdate } from "@uiw/react-codemirror";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  findMatchingAgentInstructionTokens,
  resolveAgentInstructionTemplateQuery,
} from "./agent-instructions-completion.js";
import type { AgentInstructionsEditorToken } from "./agent-instructions-token-catalog.js";

type AgentInstructionsEditorProps = {
  value: string;
  disabled: boolean;
  invalid: boolean;
  tokens: readonly AgentInstructionsEditorToken[];
  ariaLabelledBy: string;
  onChange: (value: string) => void;
};

type ActiveSuggestionState = {
  from: number;
  to: number;
  query: string;
  options: readonly AgentInstructionsEditorToken[];
};

function createAgentInstructionsEditorTheme(): ReturnType<typeof EditorView.theme> {
  return EditorView.theme({
    "&": {
      backgroundColor: "transparent",
      fontSize: "0.875rem",
    },
    ".cm-editor": {
      backgroundColor: "transparent",
    },
    ".cm-scroller": {
      fontFamily: "inherit",
      lineHeight: "1.5",
      minHeight: "12rem",
    },
    ".cm-content": {
      padding: "0.5rem 0.625rem",
      minHeight: "12rem",
      caretColor: "currentColor",
    },
    ".cm-line": {
      padding: "0",
    },
    ".cm-focused": {
      outline: "none",
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "hsl(var(--accent) / 0.45)",
    },
  });
}

function resolveSuggestionState(input: {
  documentText: string;
  cursorOffset: number;
  tokens: readonly AgentInstructionsEditorToken[];
}): ActiveSuggestionState | null {
  const resolvedQuery = resolveAgentInstructionTemplateQuery({
    documentText: input.documentText,
    cursorOffset: input.cursorOffset,
  });
  if (resolvedQuery === null) {
    return null;
  }

  const options = findMatchingAgentInstructionTokens({
    query: resolvedQuery.query,
    tokens: input.tokens,
  });
  if (options.length === 0) {
    return null;
  }

  return {
    ...resolvedQuery,
    options,
  };
}

export function AgentInstructionsEditor(input: AgentInstructionsEditorProps): React.JSX.Element {
  const [activeSuggestionState, setActiveSuggestionState] = useState<ActiveSuggestionState | null>(
    null,
  );
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const editorViewRef = useRef<CodeMirrorEditorView | null>(null);

  useEffect(() => {
    setActiveSuggestionState((currentState) => {
      if (currentState === null) {
        return null;
      }

      const nextOptions = findMatchingAgentInstructionTokens({
        query: currentState.query,
        tokens: input.tokens,
      });
      if (nextOptions.length === 0) {
        return null;
      }

      return {
        ...currentState,
        options: nextOptions,
      };
    });
  }, [input.tokens]);

  useEffect(() => {
    setSelectedSuggestionIndex((currentIndex) => {
      if (activeSuggestionState === null) {
        return 0;
      }

      return Math.min(currentIndex, activeSuggestionState.options.length - 1);
    });
  }, [activeSuggestionState]);

  function applySuggestion(token: AgentInstructionsEditorToken): boolean {
    const editorView = editorViewRef.current;
    const suggestionState = activeSuggestionState;
    if (editorView === null || suggestionState === null) {
      return false;
    }

    const insertText = token.insertText;
    const selectionAnchor = suggestionState.from + insertText.length;

    editorView.dispatch({
      changes: {
        from: suggestionState.from,
        to: suggestionState.to,
        insert: insertText,
      },
      selection: {
        anchor: selectionAnchor,
      },
    });
    editorView.focus();
    setActiveSuggestionState(null);
    setSelectedSuggestionIndex(0);
    return true;
  }

  function moveSelectedSuggestion(delta: number): boolean {
    if (activeSuggestionState === null) {
      return false;
    }

    const optionCount = activeSuggestionState.options.length;
    setSelectedSuggestionIndex(
      (currentIndex) => (currentIndex + delta + optionCount) % optionCount,
    );
    return true;
  }

  function acceptSelectedSuggestion(): boolean {
    if (activeSuggestionState === null) {
      return false;
    }

    const selectedToken = activeSuggestionState.options[selectedSuggestionIndex];
    if (selectedToken === undefined) {
      return false;
    }

    return applySuggestion(selectedToken);
  }

  const extensions = useMemo(
    () => [
      history(),
      drawSelection(),
      markdown(),
      EditorView.lineWrapping,
      Prec.highest(
        keymap.of([
          {
            key: "ArrowDown",
            run: () => moveSelectedSuggestion(1),
          },
          {
            key: "ArrowUp",
            run: () => moveSelectedSuggestion(-1),
          },
          {
            key: "Enter",
            run: acceptSelectedSuggestion,
          },
          {
            key: "Tab",
            run: acceptSelectedSuggestion,
          },
          {
            key: "Escape",
            run: () => {
              if (activeSuggestionState === null) {
                return false;
              }

              setActiveSuggestionState(null);
              setSelectedSuggestionIndex(0);
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
      ),
      EditorView.editable.of(!input.disabled),
      EditorView.contentAttributes.of({
        "aria-labelledby": input.ariaLabelledBy,
        "aria-invalid": input.invalid ? "true" : "false",
        "aria-multiline": "true",
        role: "textbox",
      }),
      createAgentInstructionsEditorTheme(),
    ],
    [
      acceptSelectedSuggestion,
      activeSuggestionState,
      input.ariaLabelledBy,
      input.disabled,
      input.invalid,
      moveSelectedSuggestion,
    ],
  );

  function handleUpdate(update: ViewUpdate): void {
    if (input.disabled) {
      setActiveSuggestionState(null);
      setSelectedSuggestionIndex(0);
      return;
    }

    const mainSelection = update.state.selection.main;
    if (!mainSelection.empty) {
      setActiveSuggestionState(null);
      setSelectedSuggestionIndex(0);
      return;
    }

    const nextSuggestionState = resolveSuggestionState({
      documentText: update.state.doc.toString(),
      cursorOffset: mainSelection.head,
      tokens: input.tokens,
    });
    setActiveSuggestionState(nextSuggestionState);

    if (nextSuggestionState === null) {
      setSelectedSuggestionIndex(0);
      return;
    }

    setSelectedSuggestionIndex((currentIndex) =>
      Math.min(currentIndex, nextSuggestionState.options.length - 1),
    );
  }

  return (
    <div className="space-y-2" data-slot="agent-instructions-editor">
      <div
        aria-disabled={input.disabled ? "true" : "false"}
        aria-invalid={input.invalid ? "true" : "false"}
        className={cn(
          "border-input focus-within:border-ring focus-within:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive rounded-md border bg-transparent shadow-xs transition-[color,box-shadow] focus-within:ring-[3px] aria-invalid:ring-[3px] overflow-hidden",
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
          onCreateEditor={(view) => {
            editorViewRef.current = view;
          }}
          onUpdate={handleUpdate}
          value={input.value}
        />
      </div>
      {activeSuggestionState !== null ? (
        <div
          className="border-border bg-popover text-popover-foreground rounded-md border shadow-md"
          data-slot="agent-instructions-suggestions"
        >
          <div className="max-h-64 overflow-y-auto p-1" role="listbox">
            {activeSuggestionState.options.map((token, index) => (
              <button
                className={cn(
                  "hover:bg-accent hover:text-accent-foreground flex w-full items-start justify-between gap-4 rounded-sm px-3 py-2 text-left transition-colors",
                  index === selectedSuggestionIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground",
                )}
                key={token.path}
                onClick={() => {
                  applySuggestion(token);
                }}
                onMouseEnter={() => {
                  setSelectedSuggestionIndex(index);
                }}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{token.path}</span>
                  {token.description === undefined ? null : (
                    <span className="text-muted-foreground block truncate text-xs">
                      {token.description}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">{token.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
