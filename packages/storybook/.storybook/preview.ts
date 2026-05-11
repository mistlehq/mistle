import type { Preview } from "@storybook/react-vite";

import "./preview.css";

Object.assign(import.meta.env, {
  VITE_CONTROL_PLANE_API_ORIGIN: "https://control-plane.example.com",
});

const preview: Preview = {
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
