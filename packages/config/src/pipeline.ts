import { getConfigValueAtPath, setConfigValueAtPath } from "./core/config-object-node.js";
import type { ConfigModule } from "./core/module.js";

export function loadFromToml(
  modules: readonly ConfigModule[],
  tomlRoot: Record<string, unknown>,
): Record<string, unknown> {
  let loaded: Record<string, unknown> = {};

  for (const module of modules) {
    const moduleValue = module.loadToml(tomlRoot);
    loaded = setConfigValueAtPath(loaded, module.namespace, moduleValue);
  }

  return loaded;
}

export function loadFromEnv(
  modules: readonly ConfigModule[],
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  let loaded: Record<string, unknown> = {};

  for (const module of modules) {
    const moduleValue = module.loadEnv(env);
    loaded = setConfigValueAtPath(loaded, module.namespace, moduleValue);
  }

  return loaded;
}

export function validateModules(
  modules: readonly ConfigModule[],
  mergedRoot: Record<string, unknown>,
): Record<string, unknown> {
  let validated: Record<string, unknown> = {};

  for (const module of modules) {
    const value = getConfigValueAtPath(mergedRoot, module.namespace);
    const parsedValue = module.schema.parse(value);
    validated = setConfigValueAtPath(validated, module.namespace, parsedValue);
  }

  return validated;
}
