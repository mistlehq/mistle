import type { Preview } from "@storybook/react-vite";

import "@mistle/ui/styles.css";

const preview: Preview = {
  parameters: {
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
      test: "todo",
    },
  },
};

export default preview;
