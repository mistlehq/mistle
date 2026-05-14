import type { Preview } from "@storybook/react-vite";
import { createElement } from "react";

import { ResolvedAppearanceProvider } from "../../../apps/dashboard/src/features/appearance/appearance-provider.js";
import {
  isUserAppearance,
  resolveAppearance,
  UserAppearances,
  type ResolvedAppearance,
  type UserAppearance,
} from "../../../apps/dashboard/src/features/appearance/appearance.js";

import "./preview.css";

function resolveStorybookColorScheme(value: unknown): UserAppearance {
  if (!isUserAppearance(value)) {
    return UserAppearances.SYSTEM;
  }

  return value;
}

function resolveStorybookSystemPrefersDark(): boolean {
  if (typeof window.matchMedia !== "function") {
    throw new Error("window.matchMedia is required to resolve Storybook system color scheme.");
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveStorybookResolvedColorScheme(colorScheme: UserAppearance): ResolvedAppearance {
  return resolveAppearance({
    appearance: colorScheme,
    systemPrefersDark: resolveStorybookSystemPrefersDark(),
  });
}

function applyStorybookColorScheme(resolvedColorScheme: ResolvedAppearance): void {
  document.documentElement.classList.toggle("dark", resolvedColorScheme === UserAppearances.DARK);
  document.documentElement.style.colorScheme = resolvedColorScheme;
}

const preview: Preview = {
  globalTypes: {
    colorScheme: {
      description: "Dashboard color scheme",
      defaultValue: UserAppearances.SYSTEM,
      toolbar: {
        title: "Color scheme",
        icon: "mirror",
        items: [
          { value: UserAppearances.SYSTEM, title: "System" },
          { value: UserAppearances.LIGHT, title: "Light" },
          { value: UserAppearances.DARK, title: "Dark" },
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
