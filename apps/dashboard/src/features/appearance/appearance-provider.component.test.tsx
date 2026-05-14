// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  AppearanceProvider,
  SystemAppearanceProvider,
  useResolvedAppearance,
} from "./appearance-provider.js";

function ResolvedAppearanceProbe(): React.JSX.Element {
  return <div>{useResolvedAppearance()}</div>;
}

describe("appearance providers", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
  });

  it("resolves unauthenticated system appearance from the current system color scheme", () => {
    render(
      <SystemAppearanceProvider>
        <ResolvedAppearanceProbe />
      </SystemAppearanceProvider>,
    );

    expect(screen.getByText("light")).toBeDefined();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("applies an explicit authenticated appearance", () => {
    render(
      <AppearanceProvider appearance="dark">
        <ResolvedAppearanceProbe />
      </AppearanceProvider>,
    );

    expect(screen.getByText("dark")).toBeDefined();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
