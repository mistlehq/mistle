import { describe, expect, it } from "vitest";

import {
  mergeDesignerCanvasTabSnapshotIntoLatestTabs,
  removeDesignerCanvasTabFromLatestTabs,
} from "./designer-canvas-tabs.js";
import { resolveDesignerCanvasReturnTabRequest } from "./designer-session-page.js";

describe("mergeDesignerCanvasTabSnapshotIntoLatestTabs", () => {
  it("rebases canvas tab snapshots onto tabs opened by earlier queued saves", () => {
    expect(
      mergeDesignerCanvasTabSnapshotIntoLatestTabs({
        latestTabs: [
          {
            kind: "route",
            id: "integrations",
            title: "Integrations",
            href: "/integrations",
          },
          {
            kind: "route",
            id: "profile",
            title: "ABC Profile",
            href: "/sandbox-profiles/sbp_abc",
          },
        ],
        snapshotTabs: [
          {
            kind: "route",
            id: "integrations",
            title: "Slack",
            href: "/integrations/slack",
          },
        ],
      }),
    ).toEqual([
      {
        kind: "route",
        id: "integrations",
        title: "Slack",
        href: "/integrations/slack",
      },
      {
        kind: "route",
        id: "profile",
        title: "ABC Profile",
        href: "/sandbox-profiles/sbp_abc",
      },
    ]);
  });
});

describe("removeDesignerCanvasTabFromLatestTabs", () => {
  it("removes closed canvas tabs from the latest persisted tab set", () => {
    expect(
      removeDesignerCanvasTabFromLatestTabs({
        latestTabs: [
          {
            kind: "route",
            id: "integrations",
            title: "Integrations",
            href: "/integrations",
          },
          {
            kind: "route",
            id: "triggers",
            title: "ABC Triggers",
            href: "/sandbox-profiles/sbp_abc/triggers",
          },
        ],
        tabId: "integrations",
      }),
    ).toEqual([
      {
        kind: "route",
        id: "triggers",
        title: "ABC Triggers",
        href: "/sandbox-profiles/sbp_abc/triggers",
      },
    ]);
  });
});

describe("resolveDesignerCanvasReturnTabRequest", () => {
  it("builds a route tab request for a valid Designer callback return", () => {
    expect(
      resolveDesignerCanvasReturnTabRequest({
        openCanvasHref:
          "/integrations/github-cloud/icn_github/github-app/setup?githubAppManifest=created",
        openCanvasTabId: "github-setup",
      }),
    ).toEqual({
      kind: "route",
      id: "github-setup",
      title: "Integrations",
      href: "/integrations/github-cloud/icn_github/github-app/setup?githubAppManifest=created",
    });
  });

  it("ignores external or incomplete Designer callback returns", () => {
    expect(
      resolveDesignerCanvasReturnTabRequest({
        openCanvasHref: "https://github.com/apps/mistle/installations/new",
        openCanvasTabId: "github-setup",
      }),
    ).toBeNull();
    expect(
      resolveDesignerCanvasReturnTabRequest({
        openCanvasHref: "/integrations/github-cloud",
        openCanvasTabId: "",
      }),
    ).toBeNull();
  });
});
