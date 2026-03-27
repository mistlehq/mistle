import {
  SandboxProvider,
  type SandboxInspectResult,
  type SandboxInspectState,
} from "../../types.js";

export interface DockerSandboxInspectInfo {
  readonly name: string;
  readonly imageRef: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly exitCode: number | null;
  readonly running: boolean;
  readonly paused: boolean;
  readonly restarting: boolean;
  readonly dead: boolean;
}

export type DockerSandboxInspectResult = SandboxInspectResult<
  typeof SandboxProvider.DOCKER,
  SandboxInspectState,
  DockerSandboxInspectInfo
>;
