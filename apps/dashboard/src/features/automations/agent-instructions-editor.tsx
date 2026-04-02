import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Prec } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { cn } from "@mistle/ui";
import type { EditorView as CodeMirrorEditorView, ViewUpdate } from "@uiw/react-codemirror";
import CodeMirror from "@uiw/react-codemirror";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  findMatchingAgentInstructionTokens,
  rankAgentInstructionTokensForMatching,
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

type SuggestionPopoverPosition = {
  height: number;
  left: number;
  top: number;
};

type SuggestionInteractionMode = "keyboard" | "pointer";

const SuggestionPopoverWidth = 320;
const SuggestionPopoverGap = 6;
const SuggestionPopoverMaxHeight = 256;
const SuggestionPopoverRowHeight = 44;
const SuggestionPopoverVerticalPadding = 8;

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

function areSuggestionStatesEqual(
  left: ActiveSuggestionState | null,
  right: ActiveSuggestionState | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  if (left.from !== right.from || left.to !== right.to || left.query !== right.query) {
    return false;
  }

  if (left.options.length !== right.options.length) {
    return false;
  }

  return left.options.every((token, index) => token === right.options[index]);
}

function areSuggestionPopoverPositionsEqual(
  left: SuggestionPopoverPosition | null,
  right: SuggestionPopoverPosition | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (left === null || right === null) {
    return false;
  }

  return left.height === right.height && left.left === right.left && left.top === right.top;
}

function estimateSuggestionPopoverHeight(optionCount: number): number {
  return Math.min(
    SuggestionPopoverMaxHeight,
    SuggestionPopoverVerticalPadding + optionCount * SuggestionPopoverRowHeight,
  );
}

export function AgentInstructionsEditor(input: AgentInstructionsEditorProps): React.JSX.Element {
  const rankedTokens = useMemo(
    () => rankAgentInstructionTokensForMatching(input.tokens),
    [input.tokens],
  );
  const [activeSuggestionState, setActiveSuggestionState] = useState<ActiveSuggestionState | null>(
    null,
  );
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [suggestionPopoverPosition, setSuggestionPopoverPosition] =
    useState<SuggestionPopoverPosition | null>(null);
  const [suggestionInteractionMode, setSuggestionInteractionMode] =
    useState<SuggestionInteractionMode>("pointer");
  const editorViewRef = useRef<CodeMirrorEditorView | null>(null);
  const rootElementRef = useRef<HTMLDivElement | null>(null);
  const suggestionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeSuggestionStateRef = useRef<ActiveSuggestionState | null>(null);
  const selectedSuggestionIndexRef = useRef(0);

  useEffect(() => {
    activeSuggestionStateRef.current = activeSuggestionState;
  }, [activeSuggestionState]);

  useEffect(() => {
    selectedSuggestionIndexRef.current = selectedSuggestionIndex;
  }, [selectedSuggestionIndex]);

  useEffect(() => {
    if (activeSuggestionState === null) {
      suggestionButtonRefs.current = [];
      return;
    }

    if (suggestionInteractionMode !== "keyboard") {
      return;
    }

    const activeButton = suggestionButtonRefs.current[selectedSuggestionIndex];
    activeButton?.scrollIntoView({
      block: "nearest",
    });
  }, [activeSuggestionState, selectedSuggestionIndex, suggestionInteractionMode]);

  useEffect(() => {
    setActiveSuggestionState((currentState) => {
      if (currentState === null) {
        return null;
      }

      const nextOptions = findMatchingAgentInstructionTokens({
        query: currentState.query,
        tokens: rankedTokens,
      });
      if (nextOptions.length === 0) {
        setSuggestionPopoverPosition(null);
        return null;
      }

      return {
        ...currentState,
        options: nextOptions,
      };
    });
  }, [rankedTokens]);

  useEffect(() => {
    setSelectedSuggestionIndex((currentIndex) => {
      if (activeSuggestionState === null) {
        return 0;
      }

      return Math.min(currentIndex, activeSuggestionState.options.length - 1);
    });
  }, [activeSuggestionState]);

  const applySuggestion = useCallback((token: AgentInstructionsEditorToken): boolean => {
    const editorView = editorViewRef.current;
    const suggestionState = activeSuggestionStateRef.current;
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
    setSuggestionPopoverPosition(null);
    setSuggestionInteractionMode("pointer");
    return true;
  }, []);

  const moveSelectedSuggestion = useCallback((delta: number): boolean => {
    const suggestionState = activeSuggestionStateRef.current;
    if (suggestionState === null) {
      return false;
    }

    setSuggestionInteractionMode("keyboard");
    const optionCount = suggestionState.options.length;
    setSelectedSuggestionIndex(
      (currentIndex) => (currentIndex + delta + optionCount) % optionCount,
    );
    return true;
  }, []);

  const acceptSelectedSuggestion = useCallback((): boolean => {
    const suggestionState = activeSuggestionStateRef.current;
    if (suggestionState === null) {
      return false;
    }

    const selectedToken = suggestionState.options[selectedSuggestionIndexRef.current];
    if (selectedToken === undefined) {
      return false;
    }

    return applySuggestion(selectedToken);
  }, [applySuggestion]);

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
              setSuggestionPopoverPosition(null);
              setSuggestionInteractionMode("pointer");
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
      input.ariaLabelledBy,
      input.disabled,
      input.invalid,
      acceptSelectedSuggestion,
      moveSelectedSuggestion,
    ],
  );

  const handleUpdate = useCallback(
    (update: ViewUpdate): void => {
      if (!update.view.hasFocus) {
        if (activeSuggestionStateRef.current !== null) {
          setActiveSuggestionState(null);
        }
        setSelectedSuggestionIndex(0);
        setSuggestionPopoverPosition((currentPosition) =>
          currentPosition === null ? currentPosition : null,
        );
        setSuggestionInteractionMode("pointer");
        return;
      }

      if (input.disabled) {
        if (activeSuggestionStateRef.current !== null) {
          setActiveSuggestionState(null);
        }
        setSelectedSuggestionIndex(0);
        setSuggestionPopoverPosition((currentPosition) =>
          currentPosition === null ? currentPosition : null,
        );
        setSuggestionInteractionMode("pointer");
        return;
      }

      const mainSelection = update.state.selection.main;
      if (!mainSelection.empty) {
        if (activeSuggestionStateRef.current !== null) {
          setActiveSuggestionState(null);
        }
        setSelectedSuggestionIndex(0);
        setSuggestionPopoverPosition((currentPosition) =>
          currentPosition === null ? currentPosition : null,
        );
        setSuggestionInteractionMode("pointer");
        return;
      }

      const nextSuggestionState = resolveSuggestionState({
        documentText: update.state.doc.toString(),
        cursorOffset: mainSelection.head,
        tokens: rankedTokens,
      });
      if (!areSuggestionStatesEqual(activeSuggestionStateRef.current, nextSuggestionState)) {
        setActiveSuggestionState(nextSuggestionState);
      }

      if (nextSuggestionState === null) {
        setSelectedSuggestionIndex(0);
        setSuggestionPopoverPosition((currentPosition) =>
          currentPosition === null ? currentPosition : null,
        );
        setSuggestionInteractionMode("pointer");
        return;
      }

      let nextSuggestionPopoverPosition: SuggestionPopoverPosition | null = null;
      const anchorCoordinates = update.view.coordsAtPos(mainSelection.head);
      const rootElement = rootElementRef.current;
      if (anchorCoordinates === null || rootElement === null) {
        nextSuggestionPopoverPosition = null;
      } else {
        const rootRect = rootElement.getBoundingClientRect();
        const horizontalPadding = 12;
        const minLeft = horizontalPadding;
        const maxLeft = Math.max(
          minLeft,
          rootRect.width - SuggestionPopoverWidth - horizontalPadding,
        );
        const desiredLeft = anchorCoordinates.left - rootRect.left;
        const estimatedPopoverHeight = estimateSuggestionPopoverHeight(
          nextSuggestionState.options.length,
        );
        const spaceBelow = window.innerHeight - anchorCoordinates.bottom;
        const spaceAbove = anchorCoordinates.top;
        const placeAbove =
          spaceBelow < estimatedPopoverHeight + SuggestionPopoverGap && spaceAbove > spaceBelow;
        const unclampedTop = placeAbove
          ? anchorCoordinates.top - rootRect.top - estimatedPopoverHeight - SuggestionPopoverGap
          : anchorCoordinates.bottom - rootRect.top + SuggestionPopoverGap;
        const minTop = 8 - rootRect.top;
        const maxTop = window.innerHeight - 8 - rootRect.top - estimatedPopoverHeight;
        const nextTop = Math.min(Math.max(unclampedTop, minTop), maxTop);

        nextSuggestionPopoverPosition = {
          height: estimatedPopoverHeight,
          left: Math.min(Math.max(desiredLeft, minLeft), maxLeft),
          top: nextTop,
        };
      }

      setSuggestionPopoverPosition((currentPosition) => {
        if (areSuggestionPopoverPositionsEqual(currentPosition, nextSuggestionPopoverPosition)) {
          return currentPosition;
        }

        return nextSuggestionPopoverPosition;
      });

      const nextSelectedSuggestionIndex = Math.min(
        selectedSuggestionIndexRef.current,
        nextSuggestionState.options.length - 1,
      );
      if (nextSelectedSuggestionIndex !== selectedSuggestionIndexRef.current) {
        setSelectedSuggestionIndex(nextSelectedSuggestionIndex);
      }
    },
    [input.disabled, rankedTokens],
  );

  return (
    <div className="relative" data-slot="agent-instructions-editor" ref={rootElementRef}>
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
      {activeSuggestionState !== null && suggestionPopoverPosition !== null ? (
        <div
          className="border-border bg-popover text-popover-foreground absolute z-20 w-80 rounded-md border text-sm shadow-md"
          data-slot="agent-instructions-suggestions"
          style={{
            height: `${suggestionPopoverPosition.height}px`,
            left: `${suggestionPopoverPosition.left}px`,
            top: `${suggestionPopoverPosition.top}px`,
          }}
        >
          <div className="h-full overflow-y-scroll p-1" role="listbox">
            {activeSuggestionState.options.map((token, index) => (
              <button
                className={cn(
                  "flex w-full items-start rounded-sm px-2.5 py-1.5 text-left transition-colors",
                  index === selectedSuggestionIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground",
                )}
                key={token.path}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySuggestion(token);
                }}
                onPointerMove={() => {
                  setSuggestionInteractionMode("pointer");
                  setSelectedSuggestionIndex(index);
                }}
                ref={(element) => {
                  suggestionButtonRefs.current[index] = element;
                }}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{token.path}</span>
                  {token.description === undefined ? null : (
                    <span className="text-muted-foreground block truncate text-[0.8125rem] leading-5">
                      {token.description}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
