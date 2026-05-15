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
          {
            key: "details",
            label: "Details",
            desktopWidth: "minmax(0,1fr)",
            hideMobileLabel: true,
          },
          { key: "enabled", label: "Enable", desktopWidth: "88px", align: "center" },
        ]}
      >
        <ResponsiveFieldListRow className="px-4 py-3">
          <ResponsiveFieldListCell columnKey="integration">GitHub</ResponsiveFieldListCell>
          <ResponsiveFieldListCell columnKey="details" hideOnMobile>
            Repositories and tools
          </ResponsiveFieldListCell>
          <ResponsiveFieldListCell columnKey="enabled">
            <button type="button">Enabled</button>
          </ResponsiveFieldListCell>
        </ResponsiveFieldListRow>
      </ResponsiveFieldList>,
    );

    expect(screen.getAllByText("Integration")).toHaveLength(2);
    expect(screen.getAllByText("Enable")).toHaveLength(2);
    expect(screen.getByText("GitHub")).toBeDefined();
    expect(screen.getByText("Repositories and tools")).toBeDefined();
    expect(screen.getByRole("button", { name: "Enabled" })).toBeDefined();
    expect(container.querySelector('[data-slot="responsive-field-list"]')?.className).toContain(
      "@container/responsive-field-list",
    );
    expect(
      container.querySelector('[data-slot="responsive-field-list-header"]')?.className,
    ).toContain("@3xl/responsive-field-list:grid");
    expect(
      container.querySelector('[data-slot="responsive-field-list-row-grid"]')?.className,
    ).toContain(
      "@3xl/responsive-field-list:grid-cols-[var(--responsive-field-list-grid-template)]",
    );
    expect(container.querySelector('[data-column-key="details"]')?.className).toContain(
      "hidden @3xl/responsive-field-list:block",
    );
    expect(container.querySelector('[data-column-key="enabled"]')?.className).toContain(
      "@3xl/responsive-field-list:justify-center",
    );
    expect(
      container.querySelector('[data-slot="responsive-field-list-mobile-label"]')?.className,
    ).toContain("@3xl/responsive-field-list:hidden");
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
