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
  connectionMethodId: "github-app-installation",
  updatedAt: "2026-04-28T00:00:00.000Z",
};

describe("renderIntegrationConnectionSetupPane", () => {
  it("renders a setup pane for supported route segments", () => {
    expect(
      isValidElement(
        renderIntegrationConnectionSetupPane({
          connection: Connection,
          setupRoute: {
            methodId: "github-app-installation",
            routeSegment: "github-app",
          },
          searchParams: new URLSearchParams(),
        }),
      ),
    ).toBe(true);
  });

  it("fails fast for unsupported route segments", () => {
    expect(() =>
      renderIntegrationConnectionSetupPane({
        connection: Connection,
        setupRoute: {
          methodId: "unsupported-method",
          routeSegment: "unsupported",
        },
        searchParams: new URLSearchParams(),
      }),
    ).toThrow("Unsupported integration setup flow 'unsupported-method/unsupported'.");
  });
});
