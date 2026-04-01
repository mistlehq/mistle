// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FormPageShell } from "./form-page.js";

describe("FormPageShell", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a centered stack by default", () => {
    render(
      <FormPageShell>
        <div>Contained content</div>
      </FormPageShell>,
    );

    const content = screen.getByText("Contained content");
    const constrainedContent = content.parentElement;
    const shell = constrainedContent?.parentElement;

    expect(shell?.className).toContain("mx-auto");
    expect(shell?.className).toContain("gap-4");
    expect(shell?.className).not.toContain("bg-muted/30");
    expect(shell?.className).not.toContain("-mx-4");
    expect(shell?.className).not.toContain("-my-6");
    expect(constrainedContent?.className).toContain("mx-auto");
    expect(constrainedContent?.className).toContain("max-w-2xl");
  });
});
