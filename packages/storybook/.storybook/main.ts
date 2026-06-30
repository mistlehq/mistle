import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { mergeConfig, type Plugin, type UserConfig, type ViteDevServer } from "vite";

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
const StorybookReactViteFrameworkPath = fileURLToPath(
  new URL("../node_modules/@storybook/react-vite", import.meta.url),
);
const StorybookControlPlaneApiOrigin = "https://control-plane.example.com";
const StorybookStoriesModuleId = "virtual:/@storybook/builder-vite/storybook-stories.js";
const StorybookStoryImportPattern = /import\("([^"]+\.stories\.(?:ts|tsx))"\)/g;
const StorybookFreshStoryModuleId = "virtual:mistle-storybook-fresh-story/";
const StorybookFreshStoryResolvedModuleId = `\0${StorybookFreshStoryModuleId}`;
const StorybookFreshStoryModuleSuffix = "/module.js";
const ViteHotContextPreamblePattern =
  /^import \{ createHotContext as __vite__createHotContext \} from "\/@vite\/client";import\.meta\.hot = __vite__createHotContext\("[^"]+"\);/;

const config: StorybookConfig = {
  framework: {
    name: StorybookReactViteFrameworkPath,
    options: {},
  },
  features: {
    changeDetection: false,
  },
  staticDirs: ["../../../apps/dashboard/public"],
  addons: ["@storybook/addon-docs", "@storybook/addon-links", "@storybook/addon-a11y"],
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
      plugins: [react(), tailwindcss(), storybookStoryImportCacheBustPlugin()],
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

function storybookStoryImportCacheBustPlugin(): Plugin {
  let devServer: ViteDevServer | undefined;

  return {
    name: "mistle-storybook-story-import-cache-bust",
    apply: "serve",
    configureServer(server) {
      devServer = server;
    },
    resolveId(id) {
      if (id.startsWith(StorybookFreshStoryModuleId)) {
        return `\0${id}`;
      }
    },
    async load(id) {
      if (!id.startsWith(StorybookFreshStoryResolvedModuleId)) {
        return;
      }
      if (devServer === undefined) {
        throw new Error("Storybook fresh story module loaded before the Vite dev server exists.");
      }

      const storyPath = getStorybookFreshStoryPath(id);
      const storyModules = devServer.moduleGraph.getModulesByFile(storyPath);
      if (storyModules !== undefined) {
        for (const storyModule of storyModules) {
          devServer.moduleGraph.invalidateModule(storyModule);
        }
      }

      const transformedStory = await devServer.transformRequest(storyPath);
      if (transformedStory === null) {
        throw new Error(`Unable to transform Storybook story module: ${storyPath}`);
      }

      return {
        code: stripViteHotContextPreamble(transformedStory.code),
        map: transformedStory.map,
      };
    },
    transform(code, id) {
      if (!id.includes(StorybookStoriesModuleId)) {
        return;
      }

      // Storybook's generated registry can re-import unchanged story URLs during HMR.
      const storybookFreshVersion = Date.now().toString();
      const transformedCode = code.replace(StorybookStoryImportPattern, replaceStoryImport);
      if (transformedCode === code) {
        return;
      }

      return {
        code: transformedCode,
        map: null,
      };

      function replaceStoryImport(_importStatement: string, storyPath: string): string {
        const encodedStoryPath = encodeURIComponent(storyPath);
        return `import("${StorybookFreshStoryModuleId}${storybookFreshVersion}/${encodedStoryPath}${StorybookFreshStoryModuleSuffix}")`;
      }
    },
  };
}

function getStorybookFreshStoryPath(id: string): string {
  if (!id.endsWith(StorybookFreshStoryModuleSuffix)) {
    throw new Error(`Invalid Storybook fresh story module id: ${id}`);
  }

  const storyModuleParts = id
    .slice(StorybookFreshStoryResolvedModuleId.length, -StorybookFreshStoryModuleSuffix.length)
    .split("/");
  const encodedStoryPath = storyModuleParts[1];
  if (encodedStoryPath === undefined) {
    throw new Error(`Missing Storybook fresh story path: ${id}`);
  }

  return decodeURIComponent(encodedStoryPath);
}

export function stripViteHotContextPreamble(code: string): string {
  return code.replace(ViteHotContextPreamblePattern, "");
}

export default config;
