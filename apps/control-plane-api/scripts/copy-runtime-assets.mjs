import { cpSync, mkdirSync, readdirSync } from "node:fs";

cpSync(
  new URL("../src/designer/instructions", import.meta.url),
  new URL("../dist/designer/instructions", import.meta.url),
  {
    recursive: true,
  },
);

const runtimeReferencesDistDir = new URL("../dist/designer/runtime-references/", import.meta.url);
mkdirSync(runtimeReferencesDistDir, { recursive: true });

for (const fileName of readdirSync(
  new URL("../src/designer/runtime-references", import.meta.url),
)) {
  if (!fileName.endsWith(".md")) {
    continue;
  }

  cpSync(
    new URL(`../src/designer/runtime-references/${fileName}`, import.meta.url),
    new URL(fileName, runtimeReferencesDistDir),
  );
}
