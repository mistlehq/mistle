import type { SandboxInspectDisposition, SandboxInspectResult } from "./types.js";

export function classifySandboxInspectProviderState(
  input: SandboxInspectResult,
): SandboxInspectDisposition {
  return input.disposition;
}
