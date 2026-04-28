// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormPageStack } from "./form-page.js";

describe("FormPageStack", () => {
  it("uses the standard form document spacing", () => {
    const { container } = render(
      <FormPageStack>
        <div>First section</div>
        <div>Second section</div>
      </FormPageStack>,
    );

    expect(container.firstElementChild?.className).toContain("gap-6");
    expect(screen.getByText("First section")).toBeDefined();
    expect(screen.getByText("Second section")).toBeDefined();
  });
});
