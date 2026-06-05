import type { Extension } from "@codemirror/state";
import { drawSelection, EditorView } from "@codemirror/view";

type CodeMirrorThemeSpec = Parameters<typeof EditorView.theme>[0];
type CodeMirrorThemeRule = CodeMirrorThemeSpec[string];

export const CodeMirrorThemeValues: {
  MONO_FONT_FAMILY: string;
  PROSE_TEXT_CLASS_NAME: string;
  SELECTION_BACKGROUND: string;
  TEXTAREA_PADDING_BLOCK: string;
  TEXTAREA_PADDING_INLINE: string;
} = {
  MONO_FONT_FAMILY:
    "var(--font-mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, Consolas, Liberation Mono, monospace)",
  PROSE_TEXT_CLASS_NAME: "text-base md:text-sm",
  SELECTION_BACKGROUND: "color-mix(in oklch, var(--accent) 45%, transparent)",
  TEXTAREA_PADDING_BLOCK: "calc(var(--spacing) * 2)",
  TEXTAREA_PADDING_INLINE: "calc(var(--spacing) * 2.5)",
};

export function createCodeMirrorTheme(input: {
  content?: CodeMirrorThemeRule;
  editor?: CodeMirrorThemeRule;
  root?: CodeMirrorThemeRule;
  rules?: CodeMirrorThemeSpec;
  scroller?: CodeMirrorThemeRule;
}): ReturnType<typeof EditorView.theme> {
  return EditorView.theme({
    "&": {
      backgroundColor: "transparent",
      ...(input.root ?? {}),
    },
    ".cm-editor": {
      backgroundColor: "transparent",
      ...(input.editor ?? {}),
    },
    ".cm-scroller": {
      outline: "none !important",
      ...(input.scroller ?? {}),
    },
    ".cm-content": {
      caretColor: "currentColor",
      outline: "none !important",
      ...(input.content ?? {}),
    },
    ".cm-content:focus, .cm-content:focus-visible": {
      outline: "none !important",
    },
    ".cm-line": {
      padding: "0",
    },
    "&.cm-focused, &.cm-focused .cm-scroller, &.cm-focused .cm-content": {
      outline: "none !important",
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: CodeMirrorThemeValues.SELECTION_BACKGROUND,
    },
    ...(input.rules ?? {}),
  });
}

export function createCodeMirrorPlaceholder(input: {
  className: string;
  text: string;
  view: EditorView;
}): HTMLElement {
  const element = input.view.dom.ownerDocument.createElement("div");
  element.className = input.className;
  element.textContent = input.text;

  return element;
}

export function getCodeMirrorDrawSelectionExtensions(): readonly Extension[] {
  if (typeof Range === "undefined") {
    return [];
  }

  if (typeof Range.prototype.getClientRects !== "function") {
    return [];
  }

  return [drawSelection()];
}
