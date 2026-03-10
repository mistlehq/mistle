import type { Preview } from "@storybook/react-vite";

import "./preview.css";

const preview: Preview = {
  parameters: {
    options: {
      storySort: {
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
