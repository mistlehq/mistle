import { cpSync, statSync } from "node:fs";

cpSync(
  new URL("../src/designer/instructions", import.meta.url),
  new URL("../dist/designer/instructions", import.meta.url),
  {
    recursive: true,
  },
);

cpSync(
  new URL("../src/designer/runtime-references", import.meta.url),
  new URL("../dist/designer/runtime-references", import.meta.url),
  {
    filter: (sourcePath) => statSync(sourcePath).isDirectory() || sourcePath.endsWith(".md"),
    recursive: true,
  },
);
