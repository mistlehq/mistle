import { asObjectRecord } from "../../core/record.js";
import { type PartialControlPlaneApiConfigInput, ControlPlaneApiConfigSchema } from "./schema.js";

export function loadControlPlaneApiFromToml(
  tomlRoot: Record<string, unknown>,
): PartialControlPlaneApiConfigInput {
  const apps = asObjectRecord(tomlRoot.apps);
  return ControlPlaneApiConfigSchema.partial().parse(asObjectRecord(apps.control_plane_api));
}
