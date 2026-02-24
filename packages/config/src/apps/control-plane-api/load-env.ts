import { createEnvLoader } from "../../core/load-env.js";
import { type PartialControlPlaneApiConfigInput, ControlPlaneApiConfigSchema } from "./schema.js";

const loadControlPlaneApiEnv = createEnvLoader<typeof ControlPlaneApiConfigSchema>([
  {
    key: "host",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_HOST",
    parse: (value) => value,
  },
  {
    key: "port",
    envVar: "MISTLE_APPS_CONTROL_PLANE_API_PORT",
    parse: Number,
  },
]);

export function loadControlPlaneApiFromEnv(
  env: NodeJS.ProcessEnv,
): PartialControlPlaneApiConfigInput {
  return ControlPlaneApiConfigSchema.partial().parse(loadControlPlaneApiEnv(env));
}
