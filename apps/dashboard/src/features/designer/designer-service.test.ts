import { describe, expect, it } from "vitest";

import { normalizeDesignerSessionCanvasTabs } from "./designer-service.js";

describe("normalizeDesignerSessionCanvasTabs", () => {
  it("normalizes legacy route canvas tabs saved before tab kinds were persisted", () => {
    const tabs = normalizeDesignerSessionCanvasTabs([
      {
        id: "integrations",
        title: "Integrations",
        href: "/integrations",
      },
    ]);

    expect(tabs).toEqual([
      {
        kind: "route",
        id: "integrations",
        title: "Integrations",
        href: "/integrations",
      },
    ]);
  });
});
