// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageFrame } from "./page-frame.js";

describe("PageFrame", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a centered constrained form layout for the form variant", () => {
    const { container } = render(
      <PageFrame title="Editor Shell" variant="form">
        <div>Contained content</div>
      </PageFrame>,
    );

    const content = screen.getByText("Contained content");
    const root = container.firstElementChild;
    const contentContainer = content.parentElement;

    expect(root?.className).toContain("bg-muted/30");
    expect(root?.className).toContain("px-4");
    expect(root?.className).toContain("py-6");
    expect(contentContainer?.className).toContain("mx-auto");
    expect(contentContainer?.className).toContain("max-w-2xl");
    expect(contentContainer?.className).toContain("gap-4");
  });
});
