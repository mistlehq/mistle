import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseToml } from "smol-toml";
import { z } from "zod";

export const DefaultDesignerEvalConfigPath = fileURLToPath(
  new URL("../../config/designer-eval.default.toml", import.meta.url),
);

const DesignerEvalCodexAuthSchema = z.enum(["local", "none"]);

const DesignerEvalMcpConfigSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("disabled"),
  }),
  z.object({
    mode: z.literal("eval-control-plane"),
  }),
  z.object({
    mode: z.literal("external"),
    url: z.url(),
  }),
]);

const RawDesignerEvalConfigSchema = z.object({
  runtime: z.object({
    image_ref: z.string().trim().min(1),
    codex_cli_path: z.string().trim().min(1).default("codex"),
  }),
  codex: z
    .object({
      auth: DesignerEvalCodexAuthSchema.default("local"),
      auth_path: z.string().trim().min(1).optional(),
    })
    .default({
      auth: "local",
    }),
  mcp: DesignerEvalMcpConfigSchema.default({
    mode: "disabled",
  }),
});

export type DesignerEvalCodexAuth = z.infer<typeof DesignerEvalCodexAuthSchema>;
export type DesignerEvalMcpConfig = z.infer<typeof DesignerEvalMcpConfigSchema>;

export type DesignerEvalConfig = {
  runtime: {
    imageRef: string;
    codexCliPath: string;
  };
  codex: {
    auth: DesignerEvalCodexAuth;
    authPath?: string;
  };
  mcp: DesignerEvalMcpConfig;
};

export function loadDesignerEvalConfig(input: { configPath?: string }): DesignerEvalConfig {
  const configPath = input.configPath ?? DefaultDesignerEvalConfigPath;
  const rawConfig = RawDesignerEvalConfigSchema.parse(parseToml(readFileSync(configPath, "utf8")));
  const authPath =
    rawConfig.codex.auth_path === undefined
      ? undefined
      : resolve(dirname(configPath), rawConfig.codex.auth_path);

  return {
    runtime: {
      imageRef: rawConfig.runtime.image_ref,
      codexCliPath: rawConfig.runtime.codex_cli_path,
    },
    codex: {
      auth: rawConfig.codex.auth,
      ...(authPath === undefined ? {} : { authPath }),
    },
    mcp: rawConfig.mcp,
  };
}
