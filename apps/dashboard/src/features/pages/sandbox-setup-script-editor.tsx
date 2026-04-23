import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import { cn, textareaFieldShellClassName } from "@mistle/ui";
import CodeMirror from "@uiw/react-codemirror";
import type React from "react";
import { useMemo } from "react";

type SandboxSetupScriptEditorProps = {
  ariaLabelledBy: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholderText?: string;
  value: string;
};

function supportsDrawSelection(): boolean {
  if (typeof Range === "undefined") {
    return false;
  }

  return typeof Range.prototype.getClientRects === "function";
}

function createPlaceholder(view: EditorView, placeholderText: string): HTMLElement {
  const element = view.dom.ownerDocument.createElement("div");
  element.className = "m-0 whitespace-pre-wrap font-mono text-sm leading-6 text-muted-foreground";
  element.textContent = placeholderText;

  return element;
}

function createEditorTheme(): ReturnType<typeof EditorView.theme> {
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
      fontFamily:
        "var(--font-mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, Consolas, Liberation Mono, monospace)",
      lineHeight: "1.5rem",
      minHeight: "calc(var(--spacing) * 28)",
    },
    ".cm-content": {
      caretColor: "currentColor",
      minHeight: "calc(var(--spacing) * 28)",
      paddingBlock: "calc(var(--spacing) * 2)",
      paddingInline: "calc(var(--spacing) * 2.5)",
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
  });
}

export function SandboxSetupScriptEditor(input: SandboxSetupScriptEditorProps): React.JSX.Element {
  const placeholderText = input.placeholderText;

  const extensions = useMemo(
    () =>
      [
        history(),
        ...(supportsDrawSelection() ? [drawSelection()] : []),
        ...(placeholderText === undefined
          ? []
          : [placeholder((view) => createPlaceholder(view, placeholderText))]),
        EditorView.domEventHandlers({
          blur: () => {
            input.onBlur?.();
          },
        }),
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.editable.of(!(input.disabled ?? false)),
        EditorView.contentAttributes.of({
          "aria-labelledby": input.ariaLabelledBy,
          "aria-multiline": "true",
          ...(placeholderText === undefined ? {} : { "aria-placeholder": placeholderText }),
          role: "textbox",
        }),
        createEditorTheme(),
      ] satisfies Extension[],
    [input.ariaLabelledBy, input.disabled, input.onBlur, placeholderText],
  );

  return (
    <div
      className="relative"
      data-editor-state={input.value.length === 0 ? "empty" : "filled"}
      data-slot="sandbox-setup-script-editor"
    >
      <div
        aria-disabled={input.disabled === true ? "true" : "false"}
        className={cn(
          textareaFieldShellClassName({ focusMode: "focus-within" }),
          "overflow-hidden",
          input.disabled === true ? "cursor-not-allowed opacity-50" : null,
        )}
      >
        <CodeMirror
          basicSetup={false}
          editable={!(input.disabled ?? false)}
          extensions={extensions}
          onChange={(nextValue) => {
            input.onChange(nextValue);
          }}
          value={input.value}
        />
      </div>
    </div>
  );
}
