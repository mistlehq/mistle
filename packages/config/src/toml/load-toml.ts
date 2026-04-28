import { projectToRuntimeConfig } from "./project.js";
import { ConfigSchema } from "./schema.js";

export function loadFromToml(root: Record<string, unknown>): Record<string, unknown> {
  return projectToRuntimeConfig(ConfigSchema.parse(root));
}
