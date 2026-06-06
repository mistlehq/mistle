import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { cn, textareaFieldShellClassName } from "@mistle/ui";
import CodeMirror from "@uiw/react-codemirror";
import type React from "react";
import { useMemo } from "react";

import {
  CodeMirrorThemeValues,
  createCodeMirrorPlaceholder,
  createCodeMirrorTheme,
  getCodeMirrorDrawSelectionExtensions,
} from "../shared/code-mirror-theme.js";

type SandboxSetupScriptEditorProps = {
  ariaLabelledBy: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholderText?: string;
  value: string;
};

export const ScriptEditorVisibleLineCount = 28;
export const ScriptEditorLineHeight = "1.5rem";
export const ScriptEditorMinHeight = "calc(var(--spacing) * 28)";
export const ScriptEditorMaxHeight = `calc((${ScriptEditorLineHeight} * ${ScriptEditorVisibleLineCount}) + (var(--spacing) * 4))`;

function createPlaceholder(view: EditorView, placeholderText: string): HTMLElement {
  return createCodeMirrorPlaceholder({
    className: "m-0 whitespace-pre-wrap font-mono text-sm leading-6 text-muted-foreground",
    text: placeholderText,
    view,
  });
}

function createEditorTheme(): ReturnType<typeof EditorView.theme> {
  return createCodeMirrorTheme({
    root: {
      fontSize: "var(--text-sm)",
    },
    editor: {
      borderRadius: "inherit",
    },
    scroller: {
      borderRadius: "inherit",
      fontFamily: CodeMirrorThemeValues.MONO_FONT_FAMILY,
      lineHeight: ScriptEditorLineHeight,
      maxHeight: ScriptEditorMaxHeight,
      minHeight: ScriptEditorMinHeight,
      overflow: "auto",
    },
    content: {
      minHeight: ScriptEditorMinHeight,
      paddingBlock: CodeMirrorThemeValues.TEXTAREA_PADDING_BLOCK,
      paddingInline: CodeMirrorThemeValues.TEXTAREA_PADDING_INLINE,
    },
  });
}

export function SandboxSetupScriptEditor(input: SandboxSetupScriptEditorProps): React.JSX.Element {
  const placeholderText = input.placeholderText;

  const extensions = useMemo(
    () =>
      [
        history(),
        ...getCodeMirrorDrawSelectionExtensions(),
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
          onChange={(nextValue: string) => {
            input.onChange(nextValue);
          }}
          theme="none"
          value={input.value}
        />
      </div>
    </div>
  );
}
