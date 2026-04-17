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
});
