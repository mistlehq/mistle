import { fileURLToPath } from "node:url";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const SandboxSessionClientIndexPath = fileURLToPath(
  new URL("../../packages/sandbox-session-client/src/index.ts", import.meta.url),
);
const SandboxSessionClientBrowserPath = fileURLToPath(
  new URL("../../packages/sandbox-session-client/src/browser.ts", import.meta.url),
);
const IntegrationsDefinitionsSrcPath = fileURLToPath(
  new URL("../../packages/integrations-definitions/src", import.meta.url),
);
const IntegrationsDefinitionsIndexPath = fileURLToPath(
  new URL("../../packages/integrations-definitions/src/index.ts", import.meta.url),
);

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  server: {
    strictPort: true,
  },
  resolve: {
    alias: [
      {
        find: /^@mistle\/sandbox-session-client$/,
        replacement: SandboxSessionClientIndexPath,
      },
      {
        find: /^@mistle\/sandbox-session-client\/browser$/,
        replacement: SandboxSessionClientBrowserPath,
      },
      {
        find: /^@mistle\/integrations-definitions$/,
        replacement: IntegrationsDefinitionsIndexPath,
      },
      {
        find: /^@mistle\/integrations-definitions\/forms$/,
        replacement: fileURLToPath(
          new URL("../../packages/integrations-definitions/src/forms/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/integrations-definitions\/(.+)$/,
        replacement: `${IntegrationsDefinitionsSrcPath}/$1.ts`,
      },
    ],
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    tsconfigPaths: true,
  },
});
