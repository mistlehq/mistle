// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { DesignerCanvasWorkspace } from "./designer-session-page-view.js";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    globalThis.ResizeObserver = class ResizeObserver {
      disconnect(): void {}
      observe(): void {}
      unobserve(): void {}
    };
  }
});

describe("DesignerCanvasWorkspace", () => {
  it("renders the empty canvas state when Designer has no tabs", () => {
    render(<DesignerCanvasWorkspace tabs={[]} />);

    expect(screen.getByText("Canvas")).toBeDefined();
  });

  it("renders Designer canvas tab titles from metadata", async () => {
    render(
      <DesignerCanvasWorkspace
        tabs={[
          {
            id: "integrations",
            title: "Integrations",
            href: "/integrations",
          },
          {
            id: "sandbox-profile",
            title: "Sandbox Profile",
            href: "/sandbox-profiles/sbp_story/draft",
          },
        ]}
      />,
    );

    expect(await screen.findByText("Integrations")).toBeDefined();
    expect(await screen.findByText("Sandbox Profile")).toBeDefined();
  });
});
