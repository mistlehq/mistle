// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageFrame } from "./page-frame.js";
import { PageHeaderSidebarTriggerProvider } from "./page-header-sidebar-trigger-context.js";

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

  it("lets tabbed pages stretch their below-tabs region under the header", () => {
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

    expect(container.firstElementChild?.className).toContain("min-h-svh");
    expect(aboveTabs?.className).toContain("p-4");
    expect(belowTabs?.className).toContain("flex");
    expect(belowTabs?.className).toContain("flex-col");
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

    const header = container.querySelector('[data-slot="page-frame-header-content"]');
    const content = screen.getByText("Contained content").parentElement;

    expect(header?.className).toContain("min-[69rem]:mx-auto");
    expect(header?.className).toContain("min-[69rem]:w-full");
    expect(header?.className).toContain("min-[69rem]:max-w-5xl");
    expect(content?.className).toContain("mx-auto");
    expect(content?.className).toContain("w-full");
    expect(content?.className).toContain("max-w-5xl");
  });

  it("renders the shell sidebar trigger before the page header title", () => {
    const { container } = render(
      <PageHeaderSidebarTriggerProvider
        value={{
          control: <button type="button">Toggle Sidebar</button>,
          isVisible: true,
        }}
      >
        <PageFrame title="Generic page">
          <div>Contained content</div>
        </PageFrame>
      </PageHeaderSidebarTriggerProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    const title = screen.getByRole("heading", { name: "Generic page" });

    expect(container.querySelector('[data-slot="page-frame-header-layout"]')).toBeDefined();
    expect(trigger.compareDocumentPosition(title)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("only lets the sidebar trigger occupy form header row space while constrained content is near the shell edge", () => {
    const { container } = render(
      <PageHeaderSidebarTriggerProvider
        value={{
          control: <button type="button">Toggle Sidebar</button>,
          isVisible: true,
        }}
      >
        <PageFrame title="Profile" width="form">
          <div>Contained content</div>
        </PageFrame>
      </PageHeaderSidebarTriggerProvider>,
    );

    const layout = container.querySelector('[data-slot="page-frame-header-layout"]');
    const trigger = container.querySelector('[data-slot="page-frame-header-trigger"]');
    const header = container.querySelector('[data-slot="page-frame-header-content"]');

    expect(layout?.className).toContain("flex");
    expect(layout?.className).toContain("items-start");
    expect(layout?.className).toContain("min-[47rem]:block");
    expect(trigger?.className).toContain("shrink-0");
    expect(trigger?.className).toContain("min-[47rem]:absolute");
    expect(trigger?.className).toContain("min-[47rem]:top-0");
    expect(trigger?.className).toContain("min-[47rem]:left-0");
    expect(header?.className).toContain("flex-1");
    expect(header?.className).toContain("min-[47rem]:mx-auto");
    expect(header?.className).toContain("min-[47rem]:max-w-2xl");
  });

  it("renders the shell sidebar trigger for breadcrumb-only page frames", () => {
    render(
      <PageHeaderSidebarTriggerProvider
        value={{
          control: <button type="button">Toggle Sidebar</button>,
          isVisible: true,
        }}
      >
        <PageFrame breadcrumbs={<nav aria-label="Page breadcrumbs">Parent / Child</nav>}>
          <div>Contained content</div>
        </PageFrame>
      </PageHeaderSidebarTriggerProvider>,
    );

    const breadcrumbs = screen.getByLabelText("Page breadcrumbs");
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });

    expect(trigger.compareDocumentPosition(breadcrumbs)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("renders the shell sidebar trigger before breadcrumbs when breadcrumbs and a page header exist", () => {
    render(
      <PageHeaderSidebarTriggerProvider
        value={{
          control: <button type="button">Toggle Sidebar</button>,
          isVisible: true,
        }}
      >
        <PageFrame
          breadcrumbs={<nav aria-label="Page breadcrumbs">Parent / Child</nav>}
          title="Editor Shell"
        >
          <div>Contained content</div>
        </PageFrame>
      </PageHeaderSidebarTriggerProvider>,
    );

    const breadcrumbs = screen.getByLabelText("Page breadcrumbs");
    const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
    const title = screen.getByRole("heading", { name: "Editor Shell" });

    expect(trigger.compareDocumentPosition(breadcrumbs)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(breadcrumbs.compareDocumentPosition(title)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("only lets the sidebar trigger occupy header shell space while constrained content is near the shell edge", () => {
    const { container } = render(
      <PageHeaderSidebarTriggerProvider
        value={{
          control: <button type="button">Toggle Sidebar</button>,
          isVisible: true,
        }}
      >
        <PageFrame
          breadcrumbs={<nav aria-label="Page breadcrumbs">Parent / Child</nav>}
          title="Editor Shell"
          width="normal"
        >
          <div>Contained content</div>
        </PageFrame>
      </PageHeaderSidebarTriggerProvider>,
    );

    const layout = container.querySelector('[data-slot="page-frame-header-layout"]');
    const trigger = container.querySelector('[data-slot="page-frame-header-trigger"]');
    const header = container.querySelector('[data-slot="page-frame-header-content"]');
    const breadcrumbs = container.querySelector('[data-slot="page-frame-breadcrumb-content"]');

    expect(layout?.className).toContain("flex");
    expect(layout?.className).toContain("items-start");
    expect(layout?.className).toContain("min-[69rem]:block");
    expect(trigger?.className).toContain("shrink-0");
    expect(trigger?.className).toContain("min-[69rem]:absolute");
    expect(trigger?.className).toContain("min-[69rem]:top-0");
    expect(trigger?.className).toContain("min-[69rem]:left-0");
    expect(header?.className).toContain("flex-1");
    expect(header?.className).toContain("min-[69rem]:mx-auto");
    expect(header?.className).toContain("min-[69rem]:max-w-5xl");
    expect(breadcrumbs).toBeDefined();
  });

  it("does not render an empty page header when the shell sidebar trigger is hidden", () => {
    const { container } = render(
      <PageHeaderSidebarTriggerProvider
        value={{
          control: <button type="button">Toggle Sidebar</button>,
          isVisible: false,
        }}
      >
        <PageFrame breadcrumbs={<nav aria-label="Page breadcrumbs">Parent / Child</nav>}>
          <div>Contained content</div>
        </PageFrame>
      </PageHeaderSidebarTriggerProvider>,
    );

    expect(screen.getByLabelText("Page breadcrumbs")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Toggle Sidebar" })).toBeNull();
    expect(container.querySelector('[data-slot="page-header"]')).toBeNull();
  });
});
