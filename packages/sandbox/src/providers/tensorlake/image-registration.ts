import {
  SandboxClient,
  createSandboxImage,
  type CommandResult,
  type OutputResponse,
  type ProcessInfo,
  type Sandbox,
  type StartProcessOptions,
} from "tensorlake";

import type { SandboxSdkImageBaseImageSource } from "../../types.js";
import { createTensorlakeSandboxBaseImage } from "./base-image-definition.js";

const TensorlakeApiKeyEnv = "TENSORLAKE_API_KEY";
const TensorlakeRootfsBuilderBuildPath = "/var/lib/tensorlake/rootfs-builder/build";
const TensorlakeRootfsBuilderCommand = "/usr/local/bin/tl-rootfs-build";

export type RegisterTensorlakeSandboxBaseImageInput = {
  readonly apiKey: string;
  readonly contextPath: string;
  readonly source: Omit<SandboxSdkImageBaseImageSource, "contextPath" | "kind">;
};

export async function registerTensorlakeSandboxBaseImage(
  input: RegisterTensorlakeSandboxBaseImageInput,
): Promise<void> {
  await withTensorlakeApiKey(input.apiKey, async () => {
    await createSandboxImage(
      createTensorlakeSandboxBaseImage({
        baseImageRef: input.source.baseImageRef,
        name: input.source.imageId,
        ...(input.source.sandboxd === undefined ? {} : { sandboxd: input.source.sandboxd }),
      }),
      {
        registeredName: input.source.imageId,
        contextDir: input.contextPath,
        verbose: true,
      },
      {
        createClient: createDiagnosticTensorlakeBuildClient,
      },
    );
  });
}

type TensorlakeBuildContext = {
  readonly apiUrl: string;
  readonly apiKey?: string;
  readonly personalAccessToken?: string;
  readonly namespace: string;
  readonly organizationId?: string;
  readonly projectId?: string;
};

type TensorlakeBuildClient = {
  readonly createAndConnect: (options: {
    readonly image?: string;
    readonly cpus?: number;
    readonly memoryMb?: number;
    readonly diskMb?: number;
  }) => Promise<TensorlakeBuildSandbox>;
  readonly close: () => void;
};

type TensorlakeBuildSandbox = {
  readonly sandboxId: string;
  readonly run: (
    command: string,
    options?: {
      readonly args?: string[];
      readonly env?: Record<string, string>;
      readonly workingDir?: string;
      readonly timeout?: number;
    },
  ) => Promise<CommandResult>;
  readonly startProcess: (command: string, options?: StartProcessOptions) => Promise<ProcessInfo>;
  readonly getStdout: (pid: number) => Promise<OutputResponse>;
  readonly getStderr: (pid: number) => Promise<OutputResponse>;
  readonly getProcess: (pid: number) => Promise<ProcessInfo>;
  readonly writeFile: (path: string, content: Uint8Array) => Promise<void>;
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly terminate: () => Promise<void>;
};

function createDiagnosticTensorlakeBuildClient(
  context: TensorlakeBuildContext,
): TensorlakeBuildClient {
  const client = new SandboxClient({
    apiUrl: context.apiUrl,
    namespace: context.namespace,
    ...(context.apiKey === undefined ? {} : { apiKey: context.apiKey }),
    ...(context.organizationId === undefined ? {} : { organizationId: context.organizationId }),
    ...(context.projectId === undefined ? {} : { projectId: context.projectId }),
  });

  return {
    createAndConnect: async (options) => {
      const sandbox = await client.createAndConnect(options);
      await prepareTensorlakeRootfsBuilderUploadPath(sandbox);
      return createDiagnosticTensorlakeBuildSandbox(sandbox);
    },
    close: () => {
      client.close();
    },
  };
}

async function prepareTensorlakeRootfsBuilderUploadPath(sandbox: Sandbox): Promise<void> {
  // Tensorlake SDK 0.5.13 uploads the build context to the hardcoded
  // /var/lib/tensorlake/rootfs-builder/build path before running tl-rootfs-build.
  // Recent Tensorlake rootfs-builder sandboxes run SDK commands as a non-root user,
  // so the initial SDK mkdir fails with "Permission denied" unless we create and
  // hand ownership of the upload path to that user first. Remove this once the
  // Tensorlake builder image/SDK creates a writable upload directory itself.
  const command = "sh";
  const args = [
    "-euc",
    [
      `target=${shellQuote(TensorlakeRootfsBuilderBuildPath)}`,
      'parent="$(dirname "$target")"',
      'if [ "$(id -u)" -eq 0 ]; then',
      '  mkdir -p "$target"',
      "else",
      '  sudo mkdir -p "$target"',
      '  sudo chown -R "$(id -u):$(id -g)" "$parent"',
      "fi",
      'test -w "$target"',
    ].join("\n"),
  ];
  const result = await sandbox.run(command, { args, timeout: 30 });
  if (result.exitCode !== 0) {
    throw new Error(formatTensorlakeBuildCommandFailure(command, args, result));
  }
}

function createDiagnosticTensorlakeBuildSandbox(sandbox: Sandbox): TensorlakeBuildSandbox {
  return {
    sandboxId: sandbox.sandboxId,
    run: async (command, options) => {
      const result = await sandbox.run(command, options);
      if (result.exitCode !== 0) {
        throw new Error(formatTensorlakeBuildCommandFailure(command, options?.args ?? [], result));
      }

      return result;
    },
    startProcess: (command, options) => {
      if (command === TensorlakeRootfsBuilderCommand) {
        // Tensorlake's rootfs builder currently starts dockerd internally. Recent
        // builder sandboxes invoke this command as a non-root user, which makes
        // dockerd fail with "needs to be started with root privileges". Run only
        // the SDK-provided rootfs builder entrypoint through sudo and preserve its
        // environment; leave all other SDK commands on the default execution path.
        // Remove this once Tensorlake runs tl-rootfs-build with sufficient
        // privileges or no longer shells out to rootful dockerd.
        return sandbox.startProcess("sudo", {
          ...options,
          args: ["-E", "--", command, ...(options?.args ?? [])],
        });
      }

      return sandbox.startProcess(command, options);
    },
    getStdout: (pid) => sandbox.getStdout(pid),
    getStderr: (pid) => sandbox.getStderr(pid),
    getProcess: (pid) => sandbox.getProcess(pid),
    writeFile: (path, content) => sandbox.writeFile(path, content),
    readFile: (path) => sandbox.readFile(path),
    terminate: () => sandbox.terminate(),
  };
}

export function formatTensorlakeBuildCommandFailure(
  command: string,
  args: readonly string[],
  result: CommandResult,
): string {
  return [
    `Tensorlake rootfs builder command '${[command, ...args].join(" ")}' failed with exit code ${result.exitCode}.`,
    formatTensorlakeBuildOutput("stderr", result.stderr),
    formatTensorlakeBuildOutput("stdout", result.stdout),
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function formatTensorlakeBuildOutput(label: string, output: string): string {
  const trimmedOutput = output.trim();
  if (trimmedOutput.length === 0) {
    return "";
  }

  return `${label}:\n${trimmedOutput}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function withTensorlakeApiKey<Result>(
  apiKey: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  const previousApiKey = process.env[TensorlakeApiKeyEnv];
  process.env[TensorlakeApiKeyEnv] = apiKey;

  try {
    return await operation();
  } finally {
    if (previousApiKey === undefined) {
      delete process.env[TensorlakeApiKeyEnv];
    } else {
      process.env[TensorlakeApiKeyEnv] = previousApiKey;
    }
  }
}
