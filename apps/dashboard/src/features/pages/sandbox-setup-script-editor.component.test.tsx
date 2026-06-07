// @vitest-environment jsdom

import { EditorView } from "@codemirror/view";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SandboxSetupScriptEditor } from "./sandbox-setup-script-editor.js";

describe("SandboxSetupScriptEditor", () => {
  it("keeps long scripts inside a bounded CodeMirror scroll area", () => {
    render(
      <div>
        <span id="setup-script-label">Setup script</span>
        <SandboxSetupScriptEditor
          ariaLabelledBy="setup-script-label"
          onChange={() => {}}
          value={Array.from({ length: 80 }, (_unused, index) => `echo line-${index}`).join("\n")}
        />
      </div>,
    );

    const editor = screen.getByRole("textbox", { name: "Setup script" });
    const editorShell = editor.closest(
      '[data-slot="sandbox-setup-script-editor"]',
    )?.firstElementChild;
    const editorView = EditorView.findFromDOM(editor);

    if (editorView === null) {
      throw new Error("Expected rendered setup script editor to be backed by CodeMirror.");
    }
    if (!(editorShell instanceof HTMLElement)) {
      throw new Error("Expected rendered setup script editor shell.");
    }

    const scrollerStyles = getComputedStyle(editorView.scrollDOM);

    expect(editorShell.classList.contains("bg-background")).toBe(true);
    expect(scrollerStyles.overflow).toBe("auto");
    expect(scrollerStyles.minHeight).toBe("calc(var(--spacing) * 28)");
    expect(scrollerStyles.maxHeight).toBe("calc((1.5rem * 28) + (var(--spacing) * 4))");
  });
});
