import type { z } from "zod";

type InputOf<TSchema extends z.ZodType> = z.input<TSchema>;
type InputKey<TSchema extends z.ZodType> = Extract<keyof InputOf<TSchema>, string>;
type StringInputKey<TSchema extends z.ZodType> = {
  [Key in InputKey<TSchema>]-?: Exclude<InputOf<TSchema>[Key], undefined> extends string
    ? Key
    : never;
}[InputKey<TSchema>];

type EnvFieldDescriptorWithParse<TSchema extends z.ZodType, Key extends InputKey<TSchema>> = {
  key: Key;
  envVar: string;
  parse: (value: string) => InputOf<TSchema>[Key];
};

type EnvFieldDescriptorWithoutParse<
  TSchema extends z.ZodType,
  Key extends StringInputKey<TSchema>,
> = {
  key: Key;
  envVar: string;
  parse?: undefined;
};

type EnvFieldDescriptor<TSchema extends z.ZodType> =
  | EnvFieldDescriptorWithParse<TSchema, InputKey<TSchema>>
  | EnvFieldDescriptorWithoutParse<TSchema, StringInputKey<TSchema>>;

function hasEnvValue(value: string | undefined): value is string {
  return value !== undefined;
}

export function parseBooleanEnv(value: string, envVar: string): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`Invalid ${envVar}. Expected 'true' or 'false'.`);
}

export function hasEntries(record: Record<string, unknown>): boolean {
  return Object.keys(record).length > 0;
}

export function createEnvLoader<TSchema extends z.ZodType>(
  descriptors: readonly EnvFieldDescriptor<TSchema>[],
): (env: NodeJS.ProcessEnv) => Record<string, unknown> {
  return (env) => {
    const loaded: Record<string, unknown> = {};

    for (const descriptor of descriptors) {
      const rawValue = env[descriptor.envVar];
      if (!hasEnvValue(rawValue)) {
        continue;
      }

      if (descriptor.parse === undefined) {
        loaded[descriptor.key] = rawValue;
        continue;
      }

      loaded[descriptor.key] = descriptor.parse(rawValue);
    }

    return loaded;
  };
}
