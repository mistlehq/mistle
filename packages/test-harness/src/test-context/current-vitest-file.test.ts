import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { getCurrentVitestFilePath } from "./current-vitest-file.js";

const ThisFilePath = fileURLToPath(import.meta.url);

it("returns the current vitest file path", () => {
  expect(getCurrentVitestFilePath()).toBe(ThisFilePath);
});
