// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DefinitionList } from "./definition-list.js";

describe("DefinitionList", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders stacked label and value pairs", () => {
    const { container } = render(
      <DefinitionList
        items={[
          { id: "method", label: "Method", value: "GitHub App installation" },
          { id: "secret", label: "Webhook secret", value: "**********" },
        ]}
      />,
    );

    const list = container.querySelector("dl");

    if (list === null) {
      throw new Error("Expected definition list to render a dl element.");
    }

    expect(list).toHaveAttribute("data-slot", "definition-list");
    expect(screen.getByText("Method")).toBeTruthy();
    expect(screen.getByText("GitHub App installation")).toBeTruthy();
    expect(screen.getByText("Webhook secret")).toBeTruthy();
    expect(screen.getByText("**********")).toBeTruthy();
  });

  it("accepts custom class names on the list and items", () => {
    const { container } = render(
      <DefinitionList
        className="gap-4"
        itemClassName="text-red-500"
        items={[{ id: "method", label: "Method", value: "GitHub App installation" }]}
      />,
    );

    const list = container.querySelector("dl");

    if (list === null) {
      throw new Error("Expected definition list to render a dl element.");
    }

    expect(list.className).toContain("gap-4");
    expect(screen.getByText("Method").parentElement?.className).toContain("text-red-500");
  });
});
