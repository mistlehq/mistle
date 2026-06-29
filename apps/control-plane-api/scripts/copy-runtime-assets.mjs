import { cpSync, mkdirSync } from "node:fs";

cpSync(
  new URL("../src/designer/instructions", import.meta.url),
  new URL("../dist/designer/instructions", import.meta.url),
  {
    recursive: true,
  },
);

const runtimeReferencesDistDir = new URL("../dist/designer/runtime-references", import.meta.url);
mkdirSync(runtimeReferencesDistDir, { recursive: true });
cpSync(
  new URL("../src/designer/runtime-references/integration-catalog.md", import.meta.url),
  new URL("integration-catalog.md", runtimeReferencesDistDir),
);
