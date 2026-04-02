import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Prec } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { cn } from "@mistle/ui";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";

import { completeAgentInstructionToken } from "./agent-instructions-completion.js";
import type { AgentInstructionsEditorToken } from "./agent-instructions-token-catalog.js";

type AgentInstructionsEditorProps = {
  value: string;
  disabled: boolean;
  invalid: boolean;
  tokens: readonly AgentInstructionsEditorToken[];
  ariaLabelledBy: string;
  onChange: (value: string) => void;
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
    ".cm-tooltip": {
      borderRadius: "0.375rem",
      border: "1px solid hsl(var(--border))",
      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
      backgroundColor: "hsl(var(--background))",
      color: "hsl(var(--foreground))",
      overflow: "hidden",
    },
    ".cm-tooltip-autocomplete ul": {
      fontFamily: "inherit",
      maxHeight: "16rem",
    },
    ".cm-tooltip-autocomplete li": {
      padding: "0.375rem 0.625rem",
      border: "none",
    },
    ".cm-tooltip-autocomplete li[aria-selected]": {
      backgroundColor: "hsl(var(--accent))",
      color: "hsl(var(--accent-foreground))",
    },
    ".cm-completionLabel": {
      fontWeight: "500",
    },
    ".cm-completionDetail": {
      color: "hsl(var(--muted-foreground))",
      marginLeft: "0.5rem",
      fontStyle: "normal",
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "hsl(var(--accent) / 0.45)",
    },
  });
}

export function AgentInstructionsEditor(input: AgentInstructionsEditorProps): React.JSX.Element {
  const extensions = useMemo(
    () => [
      history(),
      drawSelection(),
      markdown(),
      EditorView.lineWrapping,
      autocompletion({
        override: [
          (context) =>
            completeAgentInstructionToken(context, {
              tokens: input.tokens,
            }),
        ],
      }),
      Prec.highest(keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap])),
      EditorView.editable.of(!input.disabled),
      EditorView.contentAttributes.of({
        "aria-labelledby": input.ariaLabelledBy,
        "aria-invalid": input.invalid ? "true" : "false",
        "aria-multiline": "true",
        role: "textbox",
      }),
      createAgentInstructionsEditorTheme(),
    ],
    [input.ariaLabelledBy, input.disabled, input.invalid, input.tokens],
  );

  return (
    <div
      aria-disabled={input.disabled ? "true" : "false"}
      aria-invalid={input.invalid ? "true" : "false"}
      className={cn(
        "border-input focus-within:border-ring focus-within:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive rounded-md border bg-transparent shadow-xs transition-[color,box-shadow] focus-within:ring-[3px] aria-invalid:ring-[3px] overflow-hidden",
        input.disabled ? "cursor-not-allowed opacity-50" : null,
      )}
      data-slot="agent-instructions-editor"
    >
      <CodeMirror
        basicSetup={false}
        editable={!input.disabled}
        extensions={extensions}
        onChange={(nextValue) => {
          input.onChange(nextValue);
        }}
        value={input.value}
      />
    </div>
  );
}
