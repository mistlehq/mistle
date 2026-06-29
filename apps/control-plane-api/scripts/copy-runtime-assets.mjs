import { cpSync } from "node:fs";

cpSync(
  new URL("../src/designer/instructions", import.meta.url),
  new URL("../dist/designer/instructions", import.meta.url),
  {
    recursive: true,
  },
);
