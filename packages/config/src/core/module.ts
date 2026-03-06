import type { z } from "zod";

type DeepOptional<TValue> = TValue extends readonly (infer Item)[]
  ? readonly Item[] | undefined
  : TValue extends (infer Item)[]
    ? Item[] | undefined
    : TValue extends object
      ? {
          [Key in keyof TValue]?: DeepOptional<Exclude<TValue[Key], undefined>> | undefined;
        }
      : TValue | undefined;

export type OptionalInput<TSchema extends z.ZodType> = DeepOptional<z.input<TSchema>>;

export type ConfigModule<TSchema extends z.ZodType = z.ZodType> = {
  namespace: readonly string[];
  schema: TSchema;
  loadToml: (tomlRoot: Record<string, unknown>) => OptionalInput<TSchema>;
  loadEnv: (env: NodeJS.ProcessEnv) => OptionalInput<TSchema>;
};
