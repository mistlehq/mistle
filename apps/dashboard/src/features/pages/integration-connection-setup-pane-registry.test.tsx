import { isValidElement } from "react";
import { describe, expect, it } from "vitest";

import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { renderIntegrationConnectionSetupPane } from "./integration-connection-setup-pane-registry.js";

const Connection: IntegrationConnection = {
  createdAt: "2026-04-28T00:00:00.000Z",
  displayName: "GitHub",
  id: "icn_setup",
  status: "active",
  targetKey: "github-cloud",
  updatedAt: "2026-04-28T00:00:00.000Z",
};

describe("renderIntegrationConnectionSetupPane", () => {
  it("renders a setup pane for supported route segments", () => {
    expect(
      isValidElement(
        renderIntegrationConnectionSetupPane({
          connection: Connection,
          routeSegment: "github-app",
        }),
      ),
    ).toBe(true);
  });

  it("fails fast for unsupported route segments", () => {
    expect(() =>
      renderIntegrationConnectionSetupPane({
        connection: Connection,
        routeSegment: "unsupported",
      }),
    ).toThrow("Unsupported integration setup route segment 'unsupported'.");
  });
});
