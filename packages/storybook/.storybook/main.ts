import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  staticDirs: ["../../../apps/dashboard/public"],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-links",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
  ],
  stories: [
    "../../ui/src/**/*.stories.@(ts|tsx)",
    "../../../apps/dashboard/src/**/*.stories.@(ts|tsx)",
  ],
  async viteFinal(config) {
    return mergeConfig(config, {
      plugins: [react(), tailwindcss()],
      resolve: {
        dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
        tsconfigPaths: true,
      },
    });
  },
};

export default config;
