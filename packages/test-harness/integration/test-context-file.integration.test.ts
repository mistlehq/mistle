import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  readTestContext,
  removeTestContext,
  resolveTestContextFilePath,
  writeTestContext,
} from "../src/index.js";

describe("test context file integration", () => {
  it("writes, reads, and removes a repo-local generated test context file", async () => {
    const id = `test-harness.integration.${randomUUID().replaceAll("-", "")}`;
    const schema = z
      .object({
        value: z.string().min(1),
        port: z.number().int().min(1).max(65_535),
      })
      .strict();

    try {
      await writeTestContext({
        id,
        value: {
          value: "ok",
          port: 5432,
        },
      });

      const filePath = resolveTestContextFilePath(id);
      const fileContents = await readFile(filePath, "utf8");
      expect(fileContents).toContain('"value": "ok"');

      const parsed = await readTestContext({
        id,
        schema,
      });
      expect(parsed).toEqual({
        value: "ok",
        port: 5432,
      });
    } finally {
      await removeTestContext(id);
    }

    await expect(
      readTestContext({
        id,
        schema,
      }),
    ).rejects.toThrow(/Failed to read test context/u);
  });
});
