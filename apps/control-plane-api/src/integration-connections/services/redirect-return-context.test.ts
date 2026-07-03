import { describe, expect, it } from "vitest";

import { buildIntegrationCallbackDashboardPath } from "./redirect-return-context.js";

describe("buildIntegrationCallbackDashboardPath", () => {
  it("uses the normal dashboard path when no return context is present", () => {
    expect(
      buildIntegrationCallbackDashboardPath({
        defaultDashboardPath: "/integrations/github-cloud?connectionId=icn_github",
        designerCanvasHref: "/integrations/github-cloud?connectionId=icn_github",
      }),
    ).toBe("/integrations/github-cloud?connectionId=icn_github");
  });

  it("wraps the next integration route in the originating Designer session", () => {
    expect(
      buildIntegrationCallbackDashboardPath({
        defaultDashboardPath: "/integrations/github-cloud",
        designerCanvasHref:
          "/integrations/github-cloud/icn_github/github-app/setup?githubAppManifest=created",
        returnContext: {
          kind: "designer-canvas",
          designerSessionId: "dsn_github_setup",
          canvasTabId: "github-setup",
        },
      }),
    ).toBe(
      "/designer/dsn_github_setup?openCanvasHref=%2Fintegrations%2Fgithub-cloud%2Ficn_github%2Fgithub-app%2Fsetup%3FgithubAppManifest%3Dcreated&openCanvasTabId=github-setup",
    );
  });
});
