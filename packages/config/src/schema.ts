import { z } from "zod";

import { ControlPlaneApiConfigSchema } from "./apps/control-plane-api/schema.js";
import { ControlPlaneWorkerConfigSchema } from "./apps/control-plane-worker/schema.js";
import { DataPlaneApiConfigSchema } from "./apps/data-plane-api/schema.js";
import { DataPlaneGatewayConfigSchema } from "./apps/data-plane-gateway/schema.js";
import {
  DataPlaneWorkerConfigSchema,
  getDataPlaneWorkerSandboxProviderValidationIssue,
} from "./apps/data-plane-worker/schema.js";
import { TokenizerProxyConfigSchema } from "./apps/tokenizer-proxy/schema.js";
import { GlobalConfigSchema } from "./global/schema.js";

export const ConfigSchema = z
  .object({
    global: GlobalConfigSchema,
    apps: z
      .object({
        control_plane_api: ControlPlaneApiConfigSchema,
        control_plane_worker: ControlPlaneWorkerConfigSchema,
        data_plane_api: DataPlaneApiConfigSchema,
        data_plane_gateway: DataPlaneGatewayConfigSchema,
        data_plane_worker: DataPlaneWorkerConfigSchema,
        tokenizer_proxy: TokenizerProxyConfigSchema,
      })
      .strict(),
  })
  .superRefine((value, ctx) => {
    const issue = getDataPlaneWorkerSandboxProviderValidationIssue({
      globalSandboxProvider: value.global.sandbox.provider,
      appSandbox: value.apps.data_plane_worker.sandbox,
    });

    if (issue === null) {
      return;
    }

    ctx.addIssue({
      code: "custom",
      path: ["apps", "data_plane_worker", ...issue.path],
      message: issue.message,
    });
  })
  .strict();

export type AppConfig = z.infer<typeof ConfigSchema>;
