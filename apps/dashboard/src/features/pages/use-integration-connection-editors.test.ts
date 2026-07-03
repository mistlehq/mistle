import { describe, expect, it } from "vitest";

import { buildIntegrationConnectionReauthorizationStartPayload } from "./use-integration-connection-editors.js";

describe("buildIntegrationConnectionReauthorizationStartPayload", () => {
  it("includes Designer return context when starting OAuth reauthorization from an embedded canvas", () => {
    const payload = buildIntegrationConnectionReauthorizationStartPayload({
      connectionId: "icn_designer_oauth",
      redirectReturnContext: {
        kind: "designer-canvas",
        designerSessionId: "dsgn_session_123",
        canvasTabId: "canvas_tab_integrations",
      },
    });

    expect(payload).toEqual({
      connectionId: "icn_designer_oauth",
      returnContext: {
        kind: "designer-canvas",
        designerSessionId: "dsgn_session_123",
        canvasTabId: "canvas_tab_integrations",
      },
    });
  });
});
