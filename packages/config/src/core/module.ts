import type { z } from "zod";

export type OptionalInput<TSchema extends z.ZodType> = {
  [Key in keyof z.input<TSchema>]?: z.input<TSchema>[Key] | undefined;
};

export type ConfigModule<TSchema extends z.ZodType = z.ZodType> = {
  namespace: readonly string[];
  schema: TSchema;
  loadToml: (tomlRoot: Record<string, unknown>) => OptionalInput<TSchema>;
  loadEnv: (env: NodeJS.ProcessEnv) => OptionalInput<TSchema>;
};
