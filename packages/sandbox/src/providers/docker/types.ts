import type Docker from "dockerode";

import {
  SandboxProvider,
  type SandboxInspectResult,
  type SandboxInspectState,
} from "../../types.js";

export type DockerSandboxInspectResult = SandboxInspectResult<
  typeof SandboxProvider.DOCKER,
  SandboxInspectState,
  Docker.ContainerInspectInfo
>;
