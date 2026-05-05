import { describe, expect, it } from "vitest";

import { shouldRenderSidebarTrigger } from "./sidebar-trigger-visibility.js";

describe("shouldRenderSidebarTrigger", () => {
  it("renders the sidebar trigger on mobile when the mobile sidebar is closed", () => {
    expect(
      shouldRenderSidebarTrigger({
        isMobile: true,
        openMobile: false,
        sidebarState: "expanded",
      }),
    ).toBe(true);
  });

  it("renders the sidebar trigger on desktop when the sidebar is collapsed", () => {
    expect(
      shouldRenderSidebarTrigger({
        isMobile: false,
        openMobile: false,
        sidebarState: "collapsed",
      }),
    ).toBe(true);
  });
});
