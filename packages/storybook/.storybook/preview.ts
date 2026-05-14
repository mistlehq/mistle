import type { Preview } from "@storybook/react-vite";
import { createElement } from "react";

import { AppearanceProvider } from "../../../apps/dashboard/src/features/appearance/appearance-provider.js";
import {
  isUserAppearance,
  UserAppearances,
  type UserAppearance,
} from "../../../apps/dashboard/src/features/appearance/appearance.js";

import "./preview.css";

function resolveStorybookColorScheme(value: unknown): UserAppearance {
  if (!isUserAppearance(value)) {
    return UserAppearances.SYSTEM;
  }

  return value;
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
      return createElement(AppearanceProvider, {
        appearance: resolveStorybookColorScheme(context.globals["colorScheme"]),
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
