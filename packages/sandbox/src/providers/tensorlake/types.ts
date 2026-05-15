import type { SandboxInfo } from "tensorlake";

import type {
  SandboxInspectDisposition,
  SandboxInspectResult,
  SandboxInspectState,
  SandboxProvider,
} from "../../types.js";

export type TensorlakeSandboxInspectResult = SandboxInspectResult<
  typeof SandboxProvider.TENSORLAKE,
  SandboxInspectState,
  SandboxInspectDisposition,
  SandboxInfo
>;
