// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormPageFrame, PageFrame } from "./page-frame.js";

describe("PageFrame", () => {
  it("renders a centered constrained layout for the form page frame", () => {
    const { container } = render(
      <FormPageFrame title="Editor Shell">
        <div>Contained content</div>
      </FormPageFrame>,
    );

    const content = screen.getByText("Contained content");
    const root = container.firstElementChild;
    const contentContainer = content.parentElement;

    expect(root?.className).toContain("bg-muted/30");
    expect(root?.className).toContain("px-4");
    expect(root?.className).toContain("py-6");
    expect(contentContainer?.className).toContain("mx-auto");
    expect(contentContainer?.className).toContain("max-w-2xl");
  });

  it("omits the shared page header when all header content is empty", () => {
    const { container } = render(
      <FormPageFrame description={undefined} title="">
        <div>Contained content</div>
      </FormPageFrame>,
    );

    expect(container.querySelector('[data-slot="page-header"]')).toBeNull();
    expect(screen.getByText("Contained content")).toBeDefined();
  });

  it("keeps the generic page frame unconstrained", () => {
    const { container } = render(
      <PageFrame title="Generic page">
        <div>Contained content</div>
      </PageFrame>,
    );

    expect(container.firstElementChild?.className).toContain("gap-4");
    expect(container.firstElementChild?.className).not.toContain("bg-muted/30");
    expect(container.querySelector('[data-slot="page-header"]')).toBeDefined();
  });

  it("supports constraining the generic page frame header and content", () => {
    const { container } = render(
      <PageFrame maxWidthClassName="max-w-5xl" title="Generic page">
        <div>Contained content</div>
      </PageFrame>,
    );

    const constrainedContainers = container.querySelectorAll(".max-w-5xl");

    expect(constrainedContainers).toHaveLength(2);
    for (const constrainedContainer of constrainedContainers) {
      expect(constrainedContainer.className).toContain("mx-auto");
      expect(constrainedContainer.className).toContain("w-full");
    }
  });
});
