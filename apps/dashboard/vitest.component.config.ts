import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const IntegrationsDefinitionsSrcPath = fileURLToPath(
  new URL("../../packages/integrations-definitions/src", import.meta.url),
);
const SandboxLifecycleIndexPath = fileURLToPath(
  new URL("../../packages/sandbox-lifecycle/src/index.ts", import.meta.url),
);

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ["workspace-src"],
    },
  },
  resolve: {
    conditions: ["workspace-src", "node", "import", "default"],
    alias: [
      {
        find: /^@mistle\/integrations-definitions$/,
        replacement: fileURLToPath(
          new URL("../../packages/integrations-definitions/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/integrations-definitions\/forms$/,
        replacement: fileURLToPath(
          new URL("../../packages/integrations-definitions/src/forms/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/integrations-core$/,
        replacement: fileURLToPath(
          new URL("../../packages/integrations-core/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/integrations-definitions\/agent-runtimes\/codex\/client$/,
        replacement: fileURLToPath(
          new URL(
            "../../packages/integrations-definitions/src/agent-runtimes/codex/client.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: /^@mistle\/integrations-definitions\/agent-runtimes\/codex$/,
        replacement: fileURLToPath(
          new URL(
            "../../packages/integrations-definitions/src/agent-runtimes/codex/index.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: /^@mistle\/integrations-definitions\/agent-runtimes\/codex\/app-server$/,
        replacement: fileURLToPath(
          new URL(
            "../../packages/integrations-definitions/src/agent-runtimes/codex/app-server.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: /^@mistle\/integrations-definitions\/(.+)$/,
        replacement: `${IntegrationsDefinitionsSrcPath}/$1.ts`,
      },
      {
        find: /^@mistle\/sandbox-session-client$/,
        replacement: fileURLToPath(
          new URL("../../packages/sandbox-session-client/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/sandbox-lifecycle$/,
        replacement: SandboxLifecycleIndexPath,
      },
      {
        find: /^@mistle\/sandbox-session-client\/node$/,
        replacement: fileURLToPath(
          new URL("../../packages/sandbox-session-client/src/node.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/sandbox-session-protocol$/,
        replacement: fileURLToPath(
          new URL("../../packages/sandbox-session-protocol/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/sandbox-session-client\/browser$/,
        replacement: fileURLToPath(
          new URL("../../packages/sandbox-session-client/src/browser.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/time$/,
        replacement: fileURLToPath(new URL("../../packages/time/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/http$/,
        replacement: fileURLToPath(new URL("../../packages/http/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/time\/testing$/,
        replacement: fileURLToPath(
          new URL("../../packages/time/src/testing/index.ts", import.meta.url),
        ),
      },
    ],
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/*.component.test.ts", "src/**/*.component.test.tsx"],
    setupFiles: ["./src/test/setup-component-vitest.ts"],
    server: {
      deps: {
        inline: ["@pierre/diffs", "@pierre/theme"],
      },
    },
  },
});
