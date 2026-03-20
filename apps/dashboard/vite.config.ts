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

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
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
    ],
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    tsconfigPaths: true,
  },
});
