import type { z } from "zod";

type DeepOptionalValue<TValue> = TValue extends readonly (infer Item)[]
  ? Item[] | undefined
  : TValue extends (infer Item)[]
    ? Item[] | undefined
    : TValue extends object
      ? DeepOptional<TValue> | undefined
      : TValue | undefined;

type DeepOptional<TValue> = {
  [Key in keyof TValue]?: DeepOptionalValue<TValue[Key]>;
};

export type OptionalInput<TSchema extends z.ZodType> = DeepOptional<z.input<TSchema>>;

export type ConfigModule<TSchema extends z.ZodType = z.ZodType> = {
  namespace: readonly string[];
  schema: TSchema;
  loadToml: (tomlRoot: Record<string, unknown>) => OptionalInput<TSchema>;
  loadEnv: (env: NodeJS.ProcessEnv) => OptionalInput<TSchema>;
};
