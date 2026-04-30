// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageFrame } from "./page-frame.js";

describe("PageFrame", () => {
  it("renders a centered constrained layout for the form page frame", () => {
    const { container } = render(
      <PageFrame title="Editor Shell" width="form">
        <div>Contained content</div>
      </PageFrame>,
    );

    const content = screen.getByText("Contained content");
    const root = container.firstElementChild;
    const contentContainer = content.parentElement;

    expect(root?.className).toContain("bg-muted/30");
    expect(root?.className).toContain("p-4");
    expect(contentContainer?.className).toContain("mx-auto");
    expect(contentContainer?.className).toContain("max-w-2xl");
  });

  it("omits the shared page header when all header content is empty", () => {
    const { container } = render(
      <PageFrame description={undefined} width="form">
        <div>Contained content</div>
      </PageFrame>,
    );

    expect(container.querySelector('[data-slot="page-header"]')).toBeNull();
    expect(screen.getByText("Contained content")).toBeDefined();
  });

  it("renders breadcrumbs above the form page header", () => {
    render(
      <PageFrame
        breadcrumbs={<nav aria-label="Page breadcrumbs">Parent / Child</nav>}
        title="Editor Shell"
        width="form"
      >
        <div>Contained content</div>
      </PageFrame>,
    );

    const breadcrumbs = screen.getByLabelText("Page breadcrumbs");
    const header = screen.getByText("Editor Shell");

    expect(breadcrumbs.compareDocumentPosition(header)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders custom title slots without wrapping them in the default heading", () => {
    render(
      <PageFrame titleSlot={<div data-slot="custom-title">Editable title</div>}>
        <div>Contained content</div>
      </PageFrame>,
    );

    expect(screen.getByText("Editable title").getAttribute("data-slot")).toBe("custom-title");
    expect(screen.queryByRole("heading", { name: "Editable title" })).toBeNull();
  });

  it("keeps the generic page frame unconstrained", () => {
    const { container } = render(
      <PageFrame title="Generic page">
        <div>Contained content</div>
      </PageFrame>,
    );

    expect(container.firstElementChild?.className).toContain("gap-4");
    expect(container.firstElementChild?.className).not.toContain("bg-muted/30");
    expect(container.firstElementChild?.className).toContain("p-4");
    expect(container.querySelector('[data-slot="page-header"]')).toBeDefined();
  });

  it("separates tabbed pages into above-tabs and below-tabs regions", () => {
    const { container } = render(
      <PageFrame
        breadcrumbs={<nav aria-label="Page breadcrumbs">Parent / Child</nav>}
        title="Generic page"
        variant="tabbed"
      >
        <div>Contained content</div>
      </PageFrame>,
    );

    const aboveTabs = container.querySelector('[data-slot="page-frame-above-tabs"]');
    const belowTabs = container.querySelector('[data-slot="page-frame-below-tabs"]');

    expect(aboveTabs?.className).toContain("p-4");
    expect(belowTabs?.className).toContain("min-h-0");
    expect(belowTabs?.className).toContain("flex-1");
    expect(container.firstElementChild?.className).not.toContain("px-4");
    expect(screen.getByLabelText("Page breadcrumbs")).toBeDefined();
  });

  it("supports constraining the generic page frame header and content", () => {
    const { container } = render(
      <PageFrame width="normal" title="Generic page">
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
