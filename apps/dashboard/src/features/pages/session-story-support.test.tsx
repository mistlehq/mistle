// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderSessionWorkbenchStoryWithChrome } from "./session-story-support.js";

describe("session-story-support", () => {
  it("renders workbench story chrome as a viewport-owned flex column without nested viewport math", () => {
    const { container } = render(
      renderSessionWorkbenchStoryWithChrome({
        children: <div>Workbench</div>,
      }),
    );

    expect(container.firstElementChild?.className).toContain("h-screen");
    expect(container.firstElementChild?.className).not.toContain("min-h-screen");
    expect(container.querySelectorAll(".flex-1.min-h-0")).toHaveLength(1);
    expect(container.querySelector('[class*="100vh"]')).toBeNull();
  });
});
