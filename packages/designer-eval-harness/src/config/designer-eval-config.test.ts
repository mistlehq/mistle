import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DefaultDesignerEvalConfigPath, loadDesignerEvalConfig } from "./designer-eval-config.ts";

describe("loadDesignerEvalConfig", () => {
  it("loads the package-owned default eval config", () => {
    const config = loadDesignerEvalConfig({
      configPath: DefaultDesignerEvalConfigPath,
    });

    expect(config).toEqual({
      runtime: {
        imageRef: "127.0.0.1:5001/mistle/designer-base:dev",
        codexCliPath: "codex",
      },
      codex: {
        auth: "local",
      },
      mcp: {
        mode: "disabled",
      },
    });
  });

  it("loads an eval-specific override config without control-plane settings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "designer-eval-config-"));
    const configPath = join(directory, "designer-eval.toml");
    await writeFile(
      configPath,
      `
[runtime]
image_ref = "registry.example.com/designer:eval"
codex_cli_path = "/usr/local/bin/codex"

[codex]
auth = "none"
auth_path = "../auth.json"

[mcp]
mode = "external"
url = "http://127.0.0.1:5100/mcp"
`.trim(),
    );

    const config = loadDesignerEvalConfig({ configPath });

    expect(config).toEqual({
      runtime: {
        imageRef: "registry.example.com/designer:eval",
        codexCliPath: "/usr/local/bin/codex",
      },
      codex: {
        auth: "none",
        authPath: resolve(directory, "../auth.json"),
      },
      mcp: {
        mode: "external",
        url: "http://127.0.0.1:5100/mcp",
      },
    });
  });

  it("rejects eval-control-plane MCP mode until the eval control plane implements MCP", async () => {
    const directory = await mkdtemp(join(tmpdir(), "designer-eval-config-"));
    const configPath = join(directory, "designer-eval.toml");
    await writeFile(
      configPath,
      `
[runtime]
image_ref = "registry.example.com/designer:eval"

[mcp]
mode = "eval-control-plane"
`.trim(),
    );

    expect(() => loadDesignerEvalConfig({ configPath })).toThrow("Invalid discriminator value");
  });
});
