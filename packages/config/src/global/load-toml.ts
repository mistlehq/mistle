import { asObjectRecord } from "../core/record.js";
import { type PartialGlobalConfigInput, GlobalConfigSchema } from "./schema.js";

export function loadGlobalFromToml(tomlRoot: Record<string, unknown>): PartialGlobalConfigInput {
  return GlobalConfigSchema.partial().parse(asObjectRecord(tomlRoot.global));
}
