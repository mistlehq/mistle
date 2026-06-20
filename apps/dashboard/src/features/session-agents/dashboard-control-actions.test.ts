import { describe, expect, it } from "vitest";

import {
  DashboardControlDynamicToolNamespace,
  DesignerCanvasTabOpenDynamicToolName,
  DesignerCanvasTabOpenDynamicToolSpec,
  DesignerCanvasTabOpenAction,
  parseDashboardControlDynamicToolCall,
} from "./dashboard-control-actions.js";

describe("dashboard control actions", () => {
  it("exposes a Designer canvas tab open dynamic tool spec", () => {
    expect(DesignerCanvasTabOpenDynamicToolSpec).toMatchObject({
      namespace: DashboardControlDynamicToolNamespace,
      name: DesignerCanvasTabOpenDynamicToolName,
      description: "Open and focus a dashboard-internal route in a Designer canvas tab.",
    });
  });

  it("parses Designer canvas tab open dynamic tool calls", () => {
    const parsed = parseDashboardControlDynamicToolCall({
      namespace: DashboardControlDynamicToolNamespace,
      tool: DesignerCanvasTabOpenDynamicToolName,
      arguments: {
        id: "integrations",
        title: "Integrations",
        href: "/integrations",
      },
    });

    expect(parsed).toEqual({
      action: DesignerCanvasTabOpenAction,
      input: {
        id: "integrations",
        title: "Integrations",
        href: "/integrations",
      },
    });
  });

  it("rejects non-dashboard hrefs", () => {
    const parsed = parseDashboardControlDynamicToolCall({
      namespace: DashboardControlDynamicToolNamespace,
      tool: DesignerCanvasTabOpenDynamicToolName,
      arguments: {
        id: "external",
        title: "External",
        href: "https://example.com",
      },
    });

    expect(parsed).toEqual({
      contentItems: [{ type: "inputText", text: "Designer canvas tab input is invalid." }],
      success: false,
    });
  });
});
