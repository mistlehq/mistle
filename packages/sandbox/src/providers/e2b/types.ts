import type { SandboxInfo } from "e2b";

import {
  SandboxProvider,
  type SandboxInspectResult,
  type SandboxInspectState,
} from "../../types.js";

export type E2BSandboxInspectResult = SandboxInspectResult<
  typeof SandboxProvider.E2B,
  SandboxInspectState,
  SandboxInfo
>;
