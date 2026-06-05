import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { mergeConfig, type UserConfig } from "vite";

const StorybookReleaseVersion = readFileSync(
  fileURLToPath(new URL("../../../VERSION", import.meta.url)),
  "utf8",
).trim();
const SandboxSessionClientIndexPath = fileURLToPath(
  new URL("../../sandbox-session-client/src/index.ts", import.meta.url),
);
const SandboxSessionClientBrowserPath = fileURLToPath(
  new URL("../../sandbox-session-client/src/browser.ts", import.meta.url),
);
const StorybookControlPlaneApiOrigin = "https://control-plane.example.com";

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
  async viteFinal(config: UserConfig) {
    return mergeConfig(config, {
      define: {
        "import.meta.env.VITE_CONTROL_PLANE_API_ORIGIN": JSON.stringify(
          StorybookControlPlaneApiOrigin,
        ),
        "import.meta.env.VITE_MISTLE_RELEASE_VERSION": JSON.stringify(StorybookReleaseVersion),
      },
      plugins: [react(), tailwindcss()],
      resolve: {
        conditions: ["workspace-src", "module", "browser", "development|production"],
        alias: [
          {
            find: /^@mistle\/sandbox-session-client$/,
            replacement: SandboxSessionClientIndexPath,
          },
          {
            find: /^@mistle\/sandbox-session-client\/browser$/,
            replacement: SandboxSessionClientBrowserPath,
          },
        ],
        dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
        tsconfigPaths: true,
      },
    });
  },
};

export default config;
