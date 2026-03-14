import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  GenericContainer,
  ImageName,
  Network,
  Wait,
  getContainerRuntimeClient,
  type StartedNetwork,
  type StartedTestContainer,
} from "testcontainers";

import { registerProcessCleanupTask, runCleanupTasks } from "../cleanup/index.js";

export type WorkspaceAppReadiness =
  | {
      kind: "http";
      path: string;
      expectedStatus: number;
    }
  | {
      kind: "command";
      command: string;
    }
  | {
      kind: "log";
      pattern: RegExp;
      times: number;
    };

export type StartWorkspaceAppInput = {
  baseImage: string;
  projectRootHostPath: string;
  workspaceDirInContainer: string;
  command: readonly string[];
  environment: Record<string, string>;
  containerPort: number;
  networkAlias: string;
  startupTimeoutMs: number;
  readiness: WorkspaceAppReadiness;
  network?: StartedNetwork;
};

export type StartDockerTargetAppInput = {
  buildContextHostPath: string;
  dockerfileRelativePath: string;
  dockerTarget: string;
  cacheBustKey?: string;
  buildArgs?: Record<string, string>;
  command?: readonly string[];
  environment: Record<string, string>;
  containerPort: number;
  networkAlias: string;
  startupTimeoutMs: number;
  readiness: WorkspaceAppReadiness;
  bindMounts?: ReadonlyArray<{
    source: string;
    target: string;
    mode?: "rw" | "ro";
  }>;
  network?: StartedNetwork;
};

export type StartedWorkspaceApp = {
  host: string;
  mappedPort: number;
  hostBaseUrl: string;
  containerBaseUrl: string;
  networkAlias: string;
  networkName: string;
  stop: () => Promise<void>;
};

const DockerTargetImageCache = new Map<string, string>();
const DockerTargetImageBuildPromises = new Map<string, Promise<string>>();
const DockerTargetManagedImages = new Set<string>();
const DockerTargetImageReferenceCounts = new Map<string, number>();
const execFileAsync = promisify(execFile);
const TRACE_TEST_HARNESS = process.env.MISTLE_TEST_HARNESS_TRACE === "1";
const HostGatewayExtraHosts = [
  {
    host: "host.docker.internal",
    ipAddress: "host-gateway",
  },
  {
    host: "host.testcontainers.internal",
    ipAddress: "host-gateway",
  },
];

function traceTestHarness(message: string): void {
  if (!TRACE_TEST_HARNESS) {
    return;
  }

  console.info(`[test-harness:shared] ${message}`);
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function validateNonEmpty(value: string, label: string): void {
  if (value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

async function validateAbsoluteDirectoryPath(path: string, label: string): Promise<void> {
  validateNonEmpty(path, label);

  if (!isAbsolute(path)) {
    throw new Error(`${label} must be an absolute path.`);
  }

  let pathStats;
  try {
    pathStats = await stat(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} could not be accessed: ${message}`);
  }

  if (!pathStats.isDirectory()) {
    throw new Error(`${label} must point to a directory.`);
  }
}

async function validateDockerfilePath(input: {
  buildContextHostPath: string;
  dockerfileRelativePath: string;
}): Promise<void> {
  validateNonEmpty(input.dockerfileRelativePath, "dockerfileRelativePath");

  if (isAbsolute(input.dockerfileRelativePath)) {
    throw new Error("dockerfileRelativePath must be relative to buildContextHostPath.");
  }

  const resolvedDockerfilePath = resolve(input.buildContextHostPath, input.dockerfileRelativePath);
  const dockerfilePathRelativeToContext = relative(
    input.buildContextHostPath,
    resolvedDockerfilePath,
  );

  if (
    dockerfilePathRelativeToContext === ".." ||
    dockerfilePathRelativeToContext.startsWith(`..${sep}`)
  ) {
    throw new Error("dockerfileRelativePath must stay within buildContextHostPath.");
  }

  let dockerfileStats;
  try {
    dockerfileStats = await stat(resolvedDockerfilePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`dockerfileRelativePath could not be accessed: ${message}`);
  }

  if (!dockerfileStats.isFile()) {
    throw new Error("dockerfileRelativePath must point to a file.");
  }
}

function createWaitStrategy(input: {
  readiness: WorkspaceAppReadiness;
  containerPort: number;
  startupTimeoutMs: number;
}) {
  if (input.readiness.kind === "http") {
    if (!input.readiness.path.startsWith("/")) {
      throw new Error("HTTP readiness path must start with '/'.");
    }

    validatePositiveInteger(input.readiness.expectedStatus, "HTTP readiness expectedStatus");

    const httpWaitStrategy = Wait.forHttp(input.readiness.path, input.containerPort, {
      abortOnContainerExit: true,
    }).forStatusCode(input.readiness.expectedStatus);

    return Wait.forAll([Wait.forListeningPorts(), httpWaitStrategy]);
  }

  if (input.readiness.kind === "command") {
    validateNonEmpty(input.readiness.command, "Command readiness command");
    return Wait.forSuccessfulCommand(input.readiness.command);
  }

  if (input.readiness.kind === "log") {
    validatePositiveInteger(input.readiness.times, "Log readiness times");
    return Wait.forLogMessage(input.readiness.pattern, input.readiness.times);
  }

  throw new Error("Unsupported readiness strategy.");
}

async function cleanupResources(input: {
  container: StartedTestContainer | undefined;
  createdNetwork: StartedNetwork | undefined;
}): Promise<void> {
  const tasks = [
    async () => {
      if (input.container !== undefined) {
        await input.container.stop({
          remove: true,
          removeVolumes: true,
          timeout: 0,
        });
      }
    },
    async () => {
      if (input.createdNetwork !== undefined) {
        await input.createdNetwork.stop();
      }
    },
  ];
  await runCleanupTasks({
    tasks,
    context: "test-harness app resource cleanup",
  });
}

async function resolveNetwork(network: StartedNetwork | undefined): Promise<{
  network: StartedNetwork;
  createdNetwork: StartedNetwork | undefined;
}> {
  if (network !== undefined) {
    return {
      network,
      createdNetwork: undefined,
    };
  }

  const createdNetwork = await new Network().start();
  return {
    network: createdNetwork,
    createdNetwork,
  };
}

function createStartedWorkspaceApp(input: {
  container: StartedTestContainer;
  network: StartedNetwork;
  networkAlias: string;
  containerPort: number;
  createdNetwork: StartedNetwork | undefined;
  postStopCleanupTask?: () => Promise<void>;
}): StartedWorkspaceApp {
  let container: StartedTestContainer | undefined = input.container;
  let createdNetwork: StartedNetwork | undefined = input.createdNetwork;
  let stopped = false;

  const stopInternal = async (): Promise<void> => {
    stopped = true;
    const tasks = [
      async () =>
        cleanupResources({
          container,
          createdNetwork,
        }),
    ];
    if (input.postStopCleanupTask !== undefined) {
      tasks.push(input.postStopCleanupTask);
    }
    await runCleanupTasks({
      tasks,
      context: "test-harness workspace app stop",
    });
    container = undefined;
    createdNetwork = undefined;
  };

  const unregisterProcessCleanupTask = registerProcessCleanupTask(async () => {
    if (stopped) {
      return;
    }

    await stopInternal();
  });

  const host = input.container.getHost();
  const mappedPort = input.container.getMappedPort(input.containerPort);

  return {
    host,
    mappedPort,
    hostBaseUrl: `http://${host}:${String(mappedPort)}`,
    containerBaseUrl: `http://${input.networkAlias}:${String(input.containerPort)}`,
    networkAlias: input.networkAlias,
    networkName: input.network.getName(),
    stop: async () => {
      if (stopped) {
        throw new Error("Workspace app container was already stopped.");
      }

      await stopInternal();
      unregisterProcessCleanupTask();
    },
  };
}

function toBuildArgsRecord(buildArgs: Record<string, string> | undefined): Record<string, string> {
  if (buildArgs === undefined) {
    return {};
  }

  return buildArgs;
}

function stringifyBuildArgs(buildArgs: Record<string, string> | undefined): string {
  if (buildArgs === undefined) {
    return "";
  }

  const entries = Object.entries(buildArgs).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

function deleteDockerTargetImageFromCache(imageName: string): void {
  for (const [cacheKey, cachedImageName] of DockerTargetImageCache.entries()) {
    if (cachedImageName === imageName) {
      DockerTargetImageCache.delete(cacheKey);
    }
  }
}

function retainDockerTargetImage(imageName: string): void {
  const activeReferences = DockerTargetImageReferenceCounts.get(imageName) ?? 0;
  DockerTargetImageReferenceCounts.set(imageName, activeReferences + 1);
}

async function removeDockerImage(imageName: string): Promise<void> {
  try {
    await execFileAsync("docker", ["image", "rm", "--force", imageName]);
  } catch (error) {
    const normalizedError = normalizeError(error);
    throw new Error(`Failed to remove Docker image ${imageName}: ${normalizedError.message}`);
  }
}

async function releaseDockerTargetImage(imageName: string): Promise<void> {
  const activeReferences = DockerTargetImageReferenceCounts.get(imageName);
  if (activeReferences === undefined) {
    return;
  }

  const remainingReferences = activeReferences - 1;
  if (remainingReferences > 0) {
    DockerTargetImageReferenceCounts.set(imageName, remainingReferences);
    return;
  }

  DockerTargetImageReferenceCounts.delete(imageName);
  if (!DockerTargetManagedImages.has(imageName)) {
    return;
  }
}

async function cleanupManagedDockerTargetImages(): Promise<void> {
  const tasks = Array.from(DockerTargetManagedImages).map((imageName) => async () => {
    await removeDockerImage(imageName);
    DockerTargetManagedImages.delete(imageName);
    DockerTargetImageReferenceCounts.delete(imageName);
    deleteDockerTargetImageFromCache(imageName);
  });

  await runCleanupTasks({
    tasks,
    context: "test-harness docker target image cleanup",
  });
}

registerProcessCleanupTask(async () => {
  await cleanupManagedDockerTargetImages();
});

function createDockerTargetImageCacheKey(input: {
  buildContextHostPath: string;
  dockerfileRelativePath: string;
  dockerTarget: string;
  cacheBustKey: string;
  buildArgs: Record<string, string> | undefined;
}): string {
  return JSON.stringify({
    buildContextHostPath: resolve(input.buildContextHostPath),
    dockerfileRelativePath: input.dockerfileRelativePath,
    dockerTarget: input.dockerTarget,
    cacheBustKey: input.cacheBustKey,
    buildArgs: stringifyBuildArgs(input.buildArgs),
  });
}

function createDockerTargetImageName(cacheKey: string): string {
  const digest = createHash("sha256").update(cacheKey).digest("hex").slice(0, 20);
  return `mistle-test-target-${digest}`;
}

async function resolveDockerTargetImageName(input: {
  buildContextHostPath: string;
  dockerfileRelativePath: string;
  dockerTarget: string;
  cacheBustKey: string;
  buildArgs: Record<string, string> | undefined;
}): Promise<string> {
  const cacheKey = createDockerTargetImageCacheKey(input);
  const cachedImageName = DockerTargetImageCache.get(cacheKey);
  if (cachedImageName !== undefined) {
    traceTestHarness(`reusing cached Docker target image ${cachedImageName}`);
    return cachedImageName;
  }

  const inFlightBuild = DockerTargetImageBuildPromises.get(cacheKey);
  if (inFlightBuild !== undefined) {
    traceTestHarness("awaiting in-flight Docker target image build");
    return inFlightBuild;
  }

  const buildPromise = (async () => {
    const imageName = createDockerTargetImageName(cacheKey);
    const containerRuntimeClient = await getContainerRuntimeClient();
    const imageExists = await containerRuntimeClient.image.exists(ImageName.fromString(imageName));

    if (!imageExists) {
      const imageBuildStartedAt = Date.now();
      traceTestHarness(`building Docker target image ${imageName} (${input.dockerTarget})`);
      await GenericContainer.fromDockerfile(
        input.buildContextHostPath,
        input.dockerfileRelativePath,
      )
        .withBuildArgs(toBuildArgsRecord(input.buildArgs))
        .withTarget(input.dockerTarget)
        .withBuildkit()
        .build(imageName, {
          deleteOnExit: true,
        });
      DockerTargetManagedImages.add(imageName);
      traceTestHarness(
        `built Docker target image ${imageName} in ${String(Date.now() - imageBuildStartedAt)}ms`,
      );
    } else {
      traceTestHarness(`found existing Docker target image ${imageName}`);
    }

    DockerTargetImageCache.set(cacheKey, imageName);
    return imageName;
  })();

  DockerTargetImageBuildPromises.set(cacheKey, buildPromise);
  try {
    return await buildPromise;
  } finally {
    DockerTargetImageBuildPromises.delete(cacheKey);
  }
}

export async function startWorkspaceApp(
  input: StartWorkspaceAppInput,
): Promise<StartedWorkspaceApp> {
  validateNonEmpty(input.baseImage, "baseImage");
  validateNonEmpty(input.workspaceDirInContainer, "workspaceDirInContainer");
  validateNonEmpty(input.networkAlias, "networkAlias");

  if (!input.workspaceDirInContainer.startsWith("/")) {
    throw new Error("workspaceDirInContainer must be an absolute path inside the container.");
  }

  if (input.command.length === 0) {
    throw new Error("command must include at least one segment.");
  }

  validatePositiveInteger(input.containerPort, "containerPort");
  validatePositiveInteger(input.startupTimeoutMs, "startupTimeoutMs");

  await validateAbsoluteDirectoryPath(input.projectRootHostPath, "projectRootHostPath");

  let container: StartedTestContainer | undefined;

  const { network, createdNetwork } = await resolveNetwork(input.network);

  try {
    const waitStrategy = createWaitStrategy({
      readiness: input.readiness,
      containerPort: input.containerPort,
      startupTimeoutMs: input.startupTimeoutMs,
    });

    container = await new GenericContainer(input.baseImage)
      .withBindMounts([
        {
          source: input.projectRootHostPath,
          target: input.workspaceDirInContainer,
          mode: "rw",
        },
      ])
      .withWorkingDir(input.workspaceDirInContainer)
      .withCommand([...input.command])
      .withEnvironment(input.environment)
      .withExtraHosts(HostGatewayExtraHosts)
      .withNetwork(network)
      .withNetworkAliases(input.networkAlias)
      .withExposedPorts(input.containerPort)
      .withWaitStrategy(waitStrategy)
      .withStartupTimeout(input.startupTimeoutMs)
      .start();

    return createStartedWorkspaceApp({
      container,
      network,
      networkAlias: input.networkAlias,
      containerPort: input.containerPort,
      createdNetwork,
    });
  } catch (startupError) {
    try {
      await cleanupResources({
        container,
        createdNetwork,
      });
    } catch (cleanupError) {
      throw new AggregateError(
        [normalizeError(startupError), normalizeError(cleanupError)],
        "Failed to start workspace app and failed during startup cleanup.",
      );
    }

    throw startupError;
  }
}

export async function startDockerTargetApp(
  input: StartDockerTargetAppInput,
): Promise<StartedWorkspaceApp> {
  validateNonEmpty(input.networkAlias, "networkAlias");
  validateNonEmpty(input.dockerTarget, "dockerTarget");
  validatePositiveInteger(input.containerPort, "containerPort");
  validatePositiveInteger(input.startupTimeoutMs, "startupTimeoutMs");

  await validateAbsoluteDirectoryPath(input.buildContextHostPath, "buildContextHostPath");
  await validateDockerfilePath({
    buildContextHostPath: input.buildContextHostPath,
    dockerfileRelativePath: input.dockerfileRelativePath,
  });

  if (input.command !== undefined && input.command.length === 0) {
    throw new Error("command must include at least one segment when provided.");
  }

  let container: StartedTestContainer | undefined;
  let imageName: string | undefined;

  const { network, createdNetwork } = await resolveNetwork(input.network);
  const startupStartedAt = Date.now();

  try {
    const waitStrategy = createWaitStrategy({
      readiness: input.readiness,
      containerPort: input.containerPort,
      startupTimeoutMs: input.startupTimeoutMs,
    });

    const resolveImageStartedAt = Date.now();
    imageName = await resolveDockerTargetImageName({
      buildContextHostPath: input.buildContextHostPath,
      dockerfileRelativePath: input.dockerfileRelativePath,
      dockerTarget: input.dockerTarget,
      cacheBustKey: input.cacheBustKey ?? "",
      buildArgs: input.buildArgs,
    });
    traceTestHarness(
      `resolved Docker target image for ${input.dockerTarget} in ${String(Date.now() - resolveImageStartedAt)}ms`,
    );

    let containerDefinition = new GenericContainer(imageName);

    containerDefinition = containerDefinition
      .withEnvironment(input.environment)
      .withExtraHosts(HostGatewayExtraHosts)
      .withNetwork(network)
      .withNetworkAliases(input.networkAlias)
      .withExposedPorts(input.containerPort)
      .withWaitStrategy(waitStrategy)
      .withStartupTimeout(input.startupTimeoutMs);

    if (input.bindMounts !== undefined && input.bindMounts.length > 0) {
      containerDefinition = containerDefinition.withBindMounts(
        input.bindMounts.map((mount) => ({
          source: mount.source,
          target: mount.target,
          mode: mount.mode ?? "rw",
        })),
      );
    }

    if (input.command !== undefined) {
      containerDefinition = containerDefinition.withCommand([...input.command]);
    }

    const containerStartStartedAt = Date.now();
    container = await containerDefinition.start();
    traceTestHarness(
      `started Docker target app ${input.dockerTarget} in ${String(Date.now() - containerStartStartedAt)}ms`,
    );
    retainDockerTargetImage(imageName);
    traceTestHarness(
      `Docker target app ${input.dockerTarget} startup complete in ${String(Date.now() - startupStartedAt)}ms`,
    );
    const startedImageName = imageName;

    return createStartedWorkspaceApp({
      container,
      network,
      networkAlias: input.networkAlias,
      containerPort: input.containerPort,
      createdNetwork,
      postStopCleanupTask: async () => {
        await releaseDockerTargetImage(startedImageName);
      },
    });
  } catch (startupError) {
    try {
      await cleanupResources({
        container,
        createdNetwork,
      });
    } catch (cleanupError) {
      throw new AggregateError(
        [normalizeError(startupError), normalizeError(cleanupError)],
        "Failed to start Docker target app and failed during startup cleanup.",
      );
    }

    throw startupError;
  }
}
