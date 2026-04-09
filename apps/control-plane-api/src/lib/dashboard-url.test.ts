import { describe, expect, it } from "vitest";

import { buildDashboardUrl } from "./dashboard-url.js";

describe("buildDashboardUrl", () => {
  it("appends dashboard paths to an origin-only base URL", () => {
    expect(buildDashboardUrl("https://app.mistle.example", "/integrations")).toBe(
      "https://app.mistle.example/integrations",
    );
  });

  it("preserves configured dashboard subpaths and clears query/hash", () => {
    expect(
      buildDashboardUrl(
        "https://app.mistle.example/dashboard?foo=bar#section",
        "/invitations/accept",
      ),
    ).toBe("https://app.mistle.example/dashboard/invitations/accept");
  });
});
