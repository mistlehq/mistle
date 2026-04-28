// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ResponsiveFieldList,
  ResponsiveFieldListCell,
  ResponsiveFieldListRow,
} from "./responsive-field-list.js";

describe("ResponsiveFieldList", () => {
  it("renders desktop headers and mobile labels from the same column definitions", () => {
    const { container } = render(
      <ResponsiveFieldList
        columns={[
          { key: "integration", label: "Integration", desktopWidth: "minmax(0,1fr)" },
          { key: "enabled", label: "Enable", desktopWidth: "88px", align: "center" },
        ]}
      >
        <ResponsiveFieldListRow className="px-4 py-3">
          <ResponsiveFieldListCell columnKey="integration">GitHub</ResponsiveFieldListCell>
          <ResponsiveFieldListCell columnKey="enabled">
            <button type="button">Enabled</button>
          </ResponsiveFieldListCell>
        </ResponsiveFieldListRow>
      </ResponsiveFieldList>,
    );

    expect(screen.getAllByText("Integration")).toHaveLength(2);
    expect(screen.getAllByText("Enable")).toHaveLength(2);
    expect(screen.getByText("GitHub")).toBeDefined();
    expect(screen.getByRole("button", { name: "Enabled" })).toBeDefined();
    expect(
      container.querySelector('[data-slot="responsive-field-list-header"]')?.className,
    ).toContain("md:grid");
    expect(container.querySelector('[data-column-key="enabled"]')?.className).toContain(
      "md:justify-center",
    );
  });

  it("fails fast when a row references an undefined column", () => {
    expect(() =>
      render(
        <ResponsiveFieldList
          columns={[{ key: "integration", label: "Integration", desktopWidth: "1fr" }]}
        >
          <ResponsiveFieldListRow>
            <ResponsiveFieldListCell columnKey="missing">GitHub</ResponsiveFieldListCell>
          </ResponsiveFieldListRow>
        </ResponsiveFieldList>,
      ),
    ).toThrow("ResponsiveFieldList column 'missing' is not defined.");
  });
});
