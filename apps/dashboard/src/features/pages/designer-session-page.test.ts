import { describe, expect, it } from "vitest";

import {
  mergeDesignerCanvasTabSnapshotIntoLatestTabs,
  removeDesignerCanvasTabFromLatestTabs,
} from "./designer-session-page.js";

describe("mergeDesignerCanvasTabSnapshotIntoLatestTabs", () => {
  it("rebases canvas tab snapshots onto tabs opened by earlier queued saves", () => {
    expect(
      mergeDesignerCanvasTabSnapshotIntoLatestTabs({
        latestTabs: [
          {
            id: "integrations",
            title: "Integrations",
            href: "/integrations",
          },
          {
            id: "profile",
            title: "ABC Profile",
            href: "/sandbox-profiles/sbp_abc",
          },
        ],
        snapshotTabs: [
          {
            id: "integrations",
            title: "Slack",
            href: "/integrations/slack",
          },
        ],
      }),
    ).toEqual([
      {
        id: "integrations",
        title: "Slack",
        href: "/integrations/slack",
      },
      {
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
            id: "integrations",
            title: "Integrations",
            href: "/integrations",
          },
          {
            id: "triggers",
            title: "ABC Triggers",
            href: "/sandbox-profiles/sbp_abc/triggers",
          },
        ],
        tabId: "integrations",
      }),
    ).toEqual([
      {
        id: "triggers",
        title: "ABC Triggers",
        href: "/sandbox-profiles/sbp_abc/triggers",
      },
    ]);
  });
});
