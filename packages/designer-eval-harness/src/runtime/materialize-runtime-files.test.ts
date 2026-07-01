import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { materializeDesignerRuntimeFiles } from "./materialize-runtime-files.ts";

describe("materializeDesignerRuntimeFiles", () => {
  it("writes absolute runtime setup paths under the output directory", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "designer-runtime-files-"));

    const materialized = await materializeDesignerRuntimeFiles({
      outputDir,
      files: [
        {
          fileId: "codex_config",
          path: "/etc/codex/config.toml",
          mode: 384,
          writeMode: "overwrite",
          content: 'model = "gpt-5.3-codex"\n',
        },
        {
          fileId: "codex_global_agents",
          path: "/root/.codex/AGENTS.md",
          mode: 384,
          writeMode: "overwrite",
          content: "Designer instructions\n",
        },
      ],
    });

    expect(materialized.map((file) => file.localPath)).toEqual([
      join(outputDir, "etc/codex/config.toml"),
      join(outputDir, "root/.codex/AGENTS.md"),
    ]);
    await expect(readFile(join(outputDir, "etc/codex/config.toml"), "utf8")).resolves.toBe(
      'model = "gpt-5.3-codex"\n',
    );
    await expect(readFile(join(outputDir, "root/.codex/AGENTS.md"), "utf8")).resolves.toBe(
      "Designer instructions\n",
    );
  });

  it("rejects relative runtime setup paths", async () => {
    await expect(
      materializeDesignerRuntimeFiles({
        outputDir: await mkdtemp(join(tmpdir(), "designer-runtime-files-")),
        files: [
          {
            fileId: "bad",
            path: "etc/codex/config.toml",
            mode: 384,
            writeMode: "overwrite",
            content: "",
          },
        ],
      }),
    ).rejects.toThrow("must be absolute");
  });
});
