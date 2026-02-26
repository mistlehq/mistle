export type ConfigRecord = Record<string, unknown>;

export type DevelopmentGeneratorWhen = "missing" | "always";

export type DevelopmentGenerator = {
  path: readonly string[];
  when?: DevelopmentGeneratorWhen;
  generate: (input: { config: ConfigRecord; currentValue: unknown }) => unknown;
};

export type DevelopmentPresetModule = {
  defaults?: ConfigRecord;
  generators?: readonly DevelopmentGenerator[];
};
