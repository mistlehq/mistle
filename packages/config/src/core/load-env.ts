import type { z } from "zod";

import type { OptionalInput } from "./module.js";

type InputOf<TSchema extends z.ZodType> = z.input<TSchema>;

type EnvFieldDescriptor<
  TSchema extends z.ZodType,
  Key extends keyof InputOf<TSchema> = keyof InputOf<TSchema>,
> = {
  key: Key;
  envVar: string;
  parse: (value: string) => InputOf<TSchema>[Key];
};

function hasEnvValue(value: string | undefined): value is string {
  return value !== undefined;
}

function setLoadedValue<TSchema extends z.ZodType, Key extends keyof InputOf<TSchema>>(
  loaded: OptionalInput<TSchema>,
  key: Key,
  value: InputOf<TSchema>[Key] | undefined,
): void {
  loaded[key] = value;
}

export function createEnvLoader<TSchema extends z.ZodType>(
  descriptors: readonly EnvFieldDescriptor<TSchema>[],
): (env: NodeJS.ProcessEnv) => OptionalInput<TSchema> {
  return (env) => {
    const loaded: OptionalInput<TSchema> = {};

    for (const descriptor of descriptors) {
      const rawValue = env[descriptor.envVar];
      if (!hasEnvValue(rawValue)) {
        continue;
      }

      setLoadedValue(loaded, descriptor.key, descriptor.parse(rawValue));
    }

    return loaded;
  };
}
