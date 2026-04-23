// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActionTile } from "./action-tile.js";

describe("ActionTile", () => {
  it("omits the trailing action container when action is null", () => {
    const { container } = render(
      <ActionTile action={null} description="Completed step description" title="Completed step" />,
    );

    const root = container.firstElementChild;
    const titleRow = screen.getByText("Completed step").parentElement;

    expect(titleRow?.className).toContain("items-center");
    expect(root?.lastElementChild?.textContent).not.toBe("Completed step description");
    expect(root?.querySelector("button")).toBeNull();
    expect(root?.children).toHaveLength(1);
  });

  it("supports info variant styling", () => {
    const { container } = render(
      <ActionTile
        action={
          <button data-slot="button" type="button">
            Show helper
          </button>
        }
        description="Generate one locally and upload it here."
        title="Need a new signing key?"
        variant="info"
      />,
    );

    expect(container.firstElementChild?.className).toContain("border-blue-200");
    expect(container.firstElementChild?.className).toContain("bg-blue-50");
    expect(screen.getByText("Need a new signing key?").className).toContain("text-blue-700");
    expect(screen.getByText("Generate one locally and upload it here.").className).toContain(
      "text-blue-400",
    );
  });
});
