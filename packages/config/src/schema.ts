import { z } from "zod";

import { ControlPlaneApiConfigSchema } from "./apps/control-plane-api/schema.js";
import { ControlPlaneWorkerConfigSchema } from "./apps/control-plane-worker/schema.js";
import { GlobalConfigSchema } from "./global/schema.js";

export const ConfigSchema = z
  .object({
    global: GlobalConfigSchema,
    apps: z
      .object({
        control_plane_api: ControlPlaneApiConfigSchema,
        control_plane_worker: ControlPlaneWorkerConfigSchema,
      })
      .strict(),
  })
  .strict();

export type AppConfig = z.infer<typeof ConfigSchema>;
