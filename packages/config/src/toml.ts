import { ConfigSchema, type Config } from "./root/schema.js";

export function loadFromToml(root: Record<string, unknown>): Config {
  return ConfigSchema.parse(root);
}
