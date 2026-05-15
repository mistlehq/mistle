import { spawnSync } from "node:child_process";

import { SandboxConfigurationError } from "../../errors.js";
import {
  SandboxBaseImagePublishModes,
  SandboxBaseImageSourceKinds,
  SandboxProvider,
  type SandboxBaseImageBuilder,
  type SandboxEnsureBaseImageRequest,
  type SandboxImageHandle,
} from "../../types.js";

export type DockerBuildBaseImageCommand = {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
};

export type DockerBaseImageBuilderOptions = {
  readonly env?: NodeJS.ProcessEnv;
};

export function createDockerBaseImageBuilderEnv(input: {
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly overrideEnv?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  if (input.overrideEnv === undefined) {
    return input.baseEnv;
  }

  return {
    ...input.baseEnv,
    ...input.overrideEnv,
  };
}

export class DockerBaseImageBuilder implements SandboxBaseImageBuilder {
  readonly #options: DockerBaseImageBuilderOptions;

  constructor(options: DockerBaseImageBuilderOptions = {}) {
    this.#options = options;
  }

  async ensureBaseImage(request: SandboxEnsureBaseImageRequest): Promise<SandboxImageHandle> {
    const command = createDockerBuildBaseImageCommand(request);
    const result = spawnSync(command.command, command.args, {
      cwd: command.cwd,
      env: createDockerBaseImageBuilderEnv({
        baseEnv: process.env,
        ...(this.#options.env === undefined ? {} : { overrideEnv: this.#options.env }),
      }),
      stdio: "inherit",
    });

    if (result.error !== undefined) {
      throw result.error;
    }

    if (result.status !== 0) {
      const failureStatus =
        result.status === null ? `signal ${String(result.signal)}` : result.status;
      throw new Error(`Docker base image build failed with exit code ${String(failureStatus)}.`);
    }

    if (request.source.kind !== SandboxBaseImageSourceKinds.DOCKERFILE) {
      throw new SandboxConfigurationError(
        "Docker base image builder requires a Dockerfile source.",
      );
    }

    return {
      provider: SandboxProvider.DOCKER,
      imageId: request.source.imageId,
      createdAt: new Date().toISOString(),
    };
  }
}

export function createDockerBaseImageBuilder(
  options: DockerBaseImageBuilderOptions = {},
): DockerBaseImageBuilder {
  return new DockerBaseImageBuilder(options);
}

export function createDockerBuildBaseImageCommand(
  request: SandboxEnsureBaseImageRequest,
): DockerBuildBaseImageCommand {
  if (request.source.kind !== SandboxBaseImageSourceKinds.DOCKERFILE) {
    throw new SandboxConfigurationError("Docker base image builder requires a Dockerfile source.");
  }

  const args = [
    "buildx",
    "build",
    "--file",
    request.source.dockerfilePath,
    "--tag",
    request.source.imageId,
  ];

  for (const imageId of request.source.additionalImageIds ?? []) {
    args.push("--tag", imageId);
  }

  for (const [key, value] of Object.entries(request.source.labels ?? {})) {
    args.push("--label", `${key}=${value}`);
  }

  if (request.platform !== undefined) {
    args.push("--platform", request.platform);
  }

  if (request.source.target !== undefined) {
    args.push("--target", request.source.target);
  }

  if (request.source.publishMode === SandboxBaseImagePublishModes.PUSH) {
    args.push("--push");
  } else {
    args.push("--load");
  }

  args.push(".");

  return {
    command: "docker",
    args,
    cwd: request.source.contextPath,
  };
}
