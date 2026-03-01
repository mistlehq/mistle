import type { z } from "zod";

type DeepOptional<TValue> = {
  [Key in keyof TValue]?: TValue[Key] extends readonly (infer Item)[]
    ? Item[] | undefined
    : TValue[Key] extends (infer Item)[]
      ? Item[] | undefined
      : TValue[Key] extends object
        ? DeepOptional<TValue[Key]> | undefined
        : TValue[Key] | undefined;
};

export type OptionalInput<TSchema extends z.ZodType> = DeepOptional<z.input<TSchema>>;

export type ConfigModule<TSchema extends z.ZodType = z.ZodType> = {
  namespace: readonly string[];
  schema: TSchema;
  loadToml: (tomlRoot: Record<string, unknown>) => OptionalInput<TSchema>;
  loadEnv: (env: NodeJS.ProcessEnv) => OptionalInput<TSchema>;
};
