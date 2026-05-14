import type { Preview } from "@storybook/react-vite";
import { createElement } from "react";

import { ResolvedAppearanceProvider } from "../../../apps/dashboard/src/features/appearance/appearance-provider.js";
import type { ResolvedAppearance } from "../../../apps/dashboard/src/features/appearance/appearance.js";

import "./preview.css";

const StorybookColorSchemes = {
  SYSTEM: "system",
  LIGHT: "light",
  DARK: "dark",
} as const;

type StorybookColorScheme = (typeof StorybookColorSchemes)[keyof typeof StorybookColorSchemes];

function isStorybookColorScheme(value: unknown): value is StorybookColorScheme {
  return (
    value === StorybookColorSchemes.SYSTEM ||
    value === StorybookColorSchemes.LIGHT ||
    value === StorybookColorSchemes.DARK
  );
}

function resolveStorybookColorScheme(value: unknown): StorybookColorScheme {
  if (!isStorybookColorScheme(value)) {
    return StorybookColorSchemes.SYSTEM;
  }

  return value;
}

function resolveStorybookSystemPrefersDark(): boolean {
  if (typeof window.matchMedia !== "function") {
    throw new Error("window.matchMedia is required to resolve Storybook system color scheme.");
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveStorybookResolvedColorScheme(
  colorScheme: StorybookColorScheme,
): ResolvedAppearance {
  if (colorScheme === StorybookColorSchemes.SYSTEM) {
    return resolveStorybookSystemPrefersDark()
      ? StorybookColorSchemes.DARK
      : StorybookColorSchemes.LIGHT;
  }

  return colorScheme;
}

function applyStorybookColorScheme(resolvedColorScheme: ResolvedAppearance): void {
  document.documentElement.classList.toggle(
    "dark",
    resolvedColorScheme === StorybookColorSchemes.DARK,
  );
  document.documentElement.style.colorScheme = resolvedColorScheme;
}

const preview: Preview = {
  globalTypes: {
    colorScheme: {
      description: "Dashboard color scheme",
      defaultValue: StorybookColorSchemes.SYSTEM,
      toolbar: {
        title: "Color scheme",
        icon: "mirror",
        items: [
          { value: StorybookColorSchemes.SYSTEM, title: "System" },
          { value: StorybookColorSchemes.LIGHT, title: "Light" },
          { value: StorybookColorSchemes.DARK, title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const resolvedColorScheme = resolveStorybookResolvedColorScheme(
        resolveStorybookColorScheme(context.globals["colorScheme"]),
      );
      applyStorybookColorScheme(resolvedColorScheme);

      return createElement(ResolvedAppearanceProvider, {
        resolvedAppearance: resolvedColorScheme,
        children: createElement(Story),
      });
    },
  ],
  parameters: {
    options: {
      storySort: {
        method: "alphabetical",
        order: ["Dashboard", "UI"],
      },
    },
    layout: "centered",
    actions: {
      argTypesRegex: "^on.*",
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: "error",
    },
  },
};

export default preview;
