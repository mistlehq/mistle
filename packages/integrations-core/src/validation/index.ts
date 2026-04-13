import { routesOverlap } from "../egress/index.js";
import { CompilerErrorCodes, IntegrationCompilerError } from "../errors/index.js";
import type {
  CompiledRuntimeArtifactSpec,
  CompiledBindingResult,
  CompiledRuntimeClient,
  CompiledWorkspaceSource,
  EgressCredentialRoute,
  RuntimeArtifactInstallStep,
  RuntimeExecCommand,
  RuntimeClientEndpointSpec,
  RuntimeClientProcessSpec,
  RuntimeFileWriteMode,
} from "../types/index.js";

const ReservedArtifactEnvKeys = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  "REQUESTS_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_DIR",
  "GIT_SSL_CAPATH",
]);

function flattenCompiledBindingResults(input: ReadonlyArray<CompiledBindingResult>): {
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  artifacts: ReadonlyArray<CompiledRuntimeArtifactSpec>;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  workspaceSources: ReadonlyArray<CompiledWorkspaceSource>;
} {
  const egressRoutes: EgressCredentialRoute[] = [];
  const artifacts: CompiledRuntimeArtifactSpec[] = [];
  const runtimeClients: CompiledRuntimeClient[] = [];
  const workspaceSources: CompiledWorkspaceSource[] = [];

  for (const compiledBindingResult of input) {
    egressRoutes.push(...compiledBindingResult.egressRoutes);
    artifacts.push(...compiledBindingResult.artifacts);
    runtimeClients.push(...compiledBindingResult.runtimeClients);
    workspaceSources.push(...compiledBindingResult.workspaceSources);
  }

  return {
    egressRoutes,
    artifacts,
    runtimeClients,
    workspaceSources,
  };
}

function validateRoutes(input: ReadonlyArray<EgressCredentialRoute>): void {
  const egressRuleIdToRoute = new Map<string, EgressCredentialRoute>();

  for (const route of input) {
    if (route.match.pathPrefixes !== undefined) {
      for (const [pathPrefixIndex, pathPrefix] of route.match.pathPrefixes.entries()) {
        if (pathPrefix.trim().length === 0) {
          throw new IntegrationCompilerError(
            CompilerErrorCodes.ROUTE_CONFLICT,
            `Egress route '${route.egressRuleId}' contains an empty path prefix at index ${pathPrefixIndex}.`,
          );
        }
      }
    }

    const existingRoute = egressRuleIdToRoute.get(route.egressRuleId);
    if (existingRoute !== undefined) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ROUTE_CONFLICT,
        `Duplicate egress rule id '${route.egressRuleId}' detected for bindings '${existingRoute.bindingId}' and '${route.bindingId}'.`,
      );
    }

    egressRuleIdToRoute.set(route.egressRuleId, route);
  }

  for (let leftIndex = 0; leftIndex < input.length; leftIndex += 1) {
    const leftRoute = input[leftIndex];
    if (leftRoute === undefined) {
      throw new Error("Expected left route to be present.");
    }

    for (let rightIndex = leftIndex + 1; rightIndex < input.length; rightIndex += 1) {
      const rightRoute = input[rightIndex];
      if (rightRoute === undefined) {
        throw new Error("Expected right route to be present.");
      }

      if (
        routesOverlap({
          left: leftRoute,
          right: rightRoute,
        })
      ) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.ROUTE_CONFLICT,
          `Overlapping egress routes detected: '${leftRoute.egressRuleId}' and '${rightRoute.egressRuleId}'.`,
        );
      }
    }
  }
}

function validateArtifacts(input: ReadonlyArray<CompiledRuntimeArtifactSpec>): void {
  const artifactByKey = new Map<string, CompiledRuntimeArtifactSpec>();

  for (const artifact of input) {
    if (artifact.env !== undefined) {
      for (const key of Object.keys(artifact.env)) {
        if (key.trim().length === 0) {
          throw new IntegrationCompilerError(
            CompilerErrorCodes.ARTIFACT_CONFLICT,
            `Artifact '${artifact.artifactKey}' contains an empty env key.`,
          );
        }

        if (key.includes("=")) {
          throw new IntegrationCompilerError(
            CompilerErrorCodes.ARTIFACT_CONFLICT,
            `Artifact '${artifact.artifactKey}' contains an invalid env key '${key}'.`,
          );
        }

        if (ReservedArtifactEnvKeys.has(key)) {
          throw new IntegrationCompilerError(
            CompilerErrorCodes.ARTIFACT_CONFLICT,
            `Artifact '${artifact.artifactKey}' may not define reserved env key '${key}'.`,
          );
        }
      }
    }

    if (artifact.lifecycle.install.length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${artifact.artifactKey}' must include at least one install command.`,
      );
    }
    const lifecycleHooks: ReadonlyArray<
      ReadonlyArray<CompiledRuntimeArtifactSpec["lifecycle"]["install"][number]>
    > = [artifact.lifecycle.install];

    for (const hookCommands of lifecycleHooks) {
      for (const installEntry of hookCommands) {
        validateArtifactInstallEntry({
          artifactKey: artifact.artifactKey,
          installEntry,
        });
      }
    }

    const existingArtifact = artifactByKey.get(artifact.artifactKey);
    if (existingArtifact === undefined) {
      artifactByKey.set(artifact.artifactKey, artifact);
      continue;
    }

    const hasEquivalentSpec =
      existingArtifact.name === artifact.name &&
      existingArtifact.description === artifact.description &&
      artifactLifecycleEquals(existingArtifact.lifecycle, artifact.lifecycle);

    if (!hasEquivalentSpec) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact key conflict detected for '${artifact.artifactKey}'.`,
      );
    }
  }
}

function validateArtifactInstallEntry(input: {
  artifactKey: string;
  installEntry: RuntimeArtifactInstallStep;
}): void {
  const { installEntry } = input;

  if (installEntry.op === "exec") {
    if (installEntry.command.args.length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${input.artifactKey}' contains an exec install step with no args.`,
      );
    }

    const commandName = installEntry.command.args[0];
    if (commandName === undefined || commandName.trim().length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${input.artifactKey}' contains an exec install step with an empty command.`,
      );
    }

    return;
  }

  if (installEntry.op === "mise_install") {
    if (installEntry.tools.length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${input.artifactKey}' contains a mise install step with no tools.`,
      );
    }

    for (const tool of installEntry.tools) {
      if (tool.trim().length === 0) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.ARTIFACT_CONFLICT,
          `Artifact '${input.artifactKey}' contains a mise install step with an empty tool entry.`,
        );
      }
    }

    return;
  }

  if (installEntry.repository.trim().length === 0) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.ARTIFACT_CONFLICT,
      `Artifact '${input.artifactKey}' contains a github release install step with an empty repository.`,
    );
  }

  if (installEntry.installPath.trim().length === 0) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.ARTIFACT_CONFLICT,
      `Artifact '${input.artifactKey}' contains a github release install step with an empty installPath.`,
    );
  }

  if (installEntry.release.kind === "tag") {
    if (installEntry.release.match === "exact" && installEntry.release.tag.trim().length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${input.artifactKey}' contains a github release install step with an empty exact tag selector.`,
      );
    }

    if (
      installEntry.release.match === "latest_matching_prefix" &&
      installEntry.release.prefix.trim().length === 0
    ) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${input.artifactKey}' contains a github release install step with an empty tag prefix selector.`,
      );
    }
  }

  if (installEntry.asset.kind === "exact") {
    if (installEntry.asset.fileName.trim().length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${input.artifactKey}' contains a github release install step with an empty asset fileName.`,
      );
    }

    if (
      installEntry.asset.format === "tar.gz" &&
      (!("extractedPath" in installEntry.asset) || installEntry.asset.extractedPath === undefined)
    ) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${input.artifactKey}' contains a github release install step with tar.gz asset '${installEntry.asset.fileName}' missing extractedPath.`,
      );
    }

    return;
  }

  for (const [archKey, archAsset] of [
    ["x86_64", installEntry.asset.x86_64],
    ["aarch64", installEntry.asset.aarch64],
  ] as const) {
    if (archAsset.fileName.trim().length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${input.artifactKey}' contains a github release install step with empty ${archKey} asset fileName.`,
      );
    }

    if (
      archAsset.format === "tar.gz" &&
      (!("extractedPath" in archAsset) || archAsset.extractedPath === undefined)
    ) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.ARTIFACT_CONFLICT,
        `Artifact '${input.artifactKey}' contains a github release install step with tar.gz ${archKey} asset '${archAsset.fileName}' missing extractedPath.`,
      );
    }
  }
}

function validateWorkspaceSources(input: ReadonlyArray<CompiledWorkspaceSource>): void {
  const sourceByPath = new Map<string, CompiledWorkspaceSource>();

  for (const workspaceSource of input) {
    if (workspaceSource.path.trim().length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        "Workspace source path must be non-empty.",
      );
    }

    if (workspaceSource.originUrl.trim().length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Workspace source '${workspaceSource.path}' must define a non-empty originUrl.`,
      );
    }

    const existingSource = sourceByPath.get(workspaceSource.path);
    if (existingSource !== undefined) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Workspace source path conflict detected for '${workspaceSource.path}'.`,
      );
    }

    sourceByPath.set(workspaceSource.path, workspaceSource);
  }
}

function artifactCommandsEqual(
  left: ReadonlyArray<CompiledRuntimeArtifactSpec["lifecycle"]["install"][number]>,
  right: ReadonlyArray<CompiledRuntimeArtifactSpec["lifecycle"]["install"][number]>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftCommand = left[index];
    const rightCommand = right[index];

    if (leftCommand === undefined || rightCommand === undefined) {
      return false;
    }

    if (!runtimeArtifactInstallEntryEquals(leftCommand, rightCommand)) {
      return false;
    }
  }

  return true;
}

function stringArrayEquals(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];

    if (leftValue === undefined || rightValue === undefined || leftValue !== rightValue) {
      return false;
    }
  }

  return true;
}

function stringRecordEquals(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  for (const [key, value] of leftEntries) {
    if (right[key] !== value) {
      return false;
    }
  }

  return true;
}

function validateAgentPtyLaunch(input: {
  bindingId: string;
  runtimeKey: string;
  runtimeId: string;
  ptyLaunch: {
    runtimeId: string;
    displayName: string;
    newLaunch: {
      ptySessionId: string;
      cols: number;
      rows: number;
      cwd?: string;
      command: string;
      args: ReadonlyArray<
        | {
            kind: "literal";
            value: string;
          }
        | {
            kind: "threadId";
          }
      >;
    };
    resumeLaunch: {
      ptySessionId: string;
      cols: number;
      rows: number;
      cwd?: string;
      command: string;
      args: ReadonlyArray<
        | {
            kind: "literal";
            value: string;
          }
        | {
            kind: "threadId";
          }
      >;
    };
  };
}): void {
  function validateLaunchTemplate(templateInput: {
    templateName: "newLaunch" | "resumeLaunch";
    template: {
      ptySessionId: string;
      cols: number;
      rows: number;
      cwd?: string;
      command: string;
      args: ReadonlyArray<
        | {
            kind: "literal";
            value: string;
          }
        | {
            kind: "threadId";
          }
      >;
    };
  }): void {
    if (templateInput.template.ptySessionId.trim().length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
        `Agent runtime '${input.runtimeKey}' for binding '${input.bindingId}' must define a non-empty ptyLaunch.${templateInput.templateName}.ptySessionId.`,
      );
    }
    if (templateInput.template.cols <= 0 || templateInput.template.rows <= 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
        `Agent runtime '${input.runtimeKey}' for binding '${input.bindingId}' must define positive ptyLaunch.${templateInput.templateName} dimensions.`,
      );
    }
    if (
      templateInput.template.cwd !== undefined &&
      templateInput.template.cwd.trim().length === 0
    ) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
        `Agent runtime '${input.runtimeKey}' for binding '${input.bindingId}' must not define an empty ptyLaunch.${templateInput.templateName}.cwd.`,
      );
    }
    if (templateInput.template.command.trim().length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
        `Agent runtime '${input.runtimeKey}' for binding '${input.bindingId}' must define a non-empty ptyLaunch.${templateInput.templateName}.command.`,
      );
    }

    let threadIdArgumentCount = 0;
    for (const [index, argument] of templateInput.template.args.entries()) {
      if (argument.kind === "literal" && argument.value.trim().length === 0) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
          `Agent runtime '${input.runtimeKey}' for binding '${input.bindingId}' contains an empty literal ptyLaunch.${templateInput.templateName} arg at index ${index}.`,
        );
      }

      if (argument.kind === "threadId") {
        threadIdArgumentCount += 1;
      }
    }

    if (templateInput.templateName === "newLaunch" && threadIdArgumentCount !== 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
        `Agent runtime '${input.runtimeKey}' for binding '${input.bindingId}' must not define threadId placeholders in ptyLaunch.newLaunch.`,
      );
    }

    if (templateInput.templateName === "resumeLaunch" && threadIdArgumentCount === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
        `Agent runtime '${input.runtimeKey}' for binding '${input.bindingId}' must define at least one threadId placeholder in ptyLaunch.resumeLaunch.`,
      );
    }
  }

  if (input.ptyLaunch.runtimeId !== input.runtimeId) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
      `Agent runtime '${input.runtimeKey}' for binding '${input.bindingId}' must declare a ptyLaunch.runtimeId matching '${input.runtimeId}'.`,
    );
  }
  if (input.ptyLaunch.displayName.trim().length === 0) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
      `Agent runtime '${input.runtimeKey}' for binding '${input.bindingId}' must define a non-empty ptyLaunch.displayName.`,
    );
  }

  validateLaunchTemplate({
    templateName: "newLaunch",
    template: input.ptyLaunch.newLaunch,
  });
  validateLaunchTemplate({
    templateName: "resumeLaunch",
    template: input.ptyLaunch.resumeLaunch,
  });
}

function artifactLifecycleEquals(
  left: CompiledRuntimeArtifactSpec["lifecycle"],
  right: CompiledRuntimeArtifactSpec["lifecycle"],
): boolean {
  return artifactCommandsEqual(left.install, right.install);
}

function runtimeExecCommandEquals(left: RuntimeExecCommand, right: RuntimeExecCommand): boolean {
  return (
    stringArrayEquals(left.args, right.args) &&
    stringRecordEquals(left.env, right.env) &&
    left.cwd === right.cwd &&
    left.timeoutMs === right.timeoutMs
  );
}

function isExactTagReleaseSelector(
  selector: Extract<RuntimeArtifactInstallStep, { op: "github_release_install" }>["release"],
): selector is Extract<
  Extract<RuntimeArtifactInstallStep, { op: "github_release_install" }>["release"],
  { kind: "tag"; match: "exact" }
> {
  return selector.kind === "tag" && selector.match === "exact";
}

function isLatestMatchingPrefixReleaseSelector(
  selector: Extract<RuntimeArtifactInstallStep, { op: "github_release_install" }>["release"],
): selector is Extract<
  Extract<RuntimeArtifactInstallStep, { op: "github_release_install" }>["release"],
  { kind: "tag"; match: "latest_matching_prefix" }
> {
  return selector.kind === "tag" && selector.match === "latest_matching_prefix";
}

function runtimeArtifactGitHubReleaseSelectorEquals(
  left: Extract<RuntimeArtifactInstallStep, { op: "github_release_install" }>["release"],
  right: Extract<RuntimeArtifactInstallStep, { op: "github_release_install" }>["release"],
): boolean {
  if (left.kind === "latest" || right.kind === "latest") {
    return left.kind === "latest" && right.kind === "latest";
  }

  if (left.match !== right.match) {
    return false;
  }

  if (isExactTagReleaseSelector(left) && isExactTagReleaseSelector(right)) {
    return left.tag === right.tag;
  }

  if (isLatestMatchingPrefixReleaseSelector(left) && isLatestMatchingPrefixReleaseSelector(right)) {
    return left.prefix === right.prefix;
  }

  return false;
}

function runtimeArtifactGitHubReleaseAssetShapeEquals(
  left:
    | Extract<
        Extract<RuntimeArtifactInstallStep, { op: "github_release_install" }>["asset"],
        { kind: "exact" }
      >
    | Extract<
        Extract<RuntimeArtifactInstallStep, { op: "github_release_install" }>["asset"],
        { kind: "by_arch" }
      >["x86_64"],
  right:
    | Extract<
        Extract<RuntimeArtifactInstallStep, { op: "github_release_install" }>["asset"],
        { kind: "exact" }
      >
    | Extract<
        Extract<RuntimeArtifactInstallStep, { op: "github_release_install" }>["asset"],
        { kind: "by_arch" }
      >["x86_64"],
): boolean {
  return (
    left.fileName === right.fileName &&
    left.format === right.format &&
    ("extractedPath" in left ? left.extractedPath : undefined) ===
      ("extractedPath" in right ? right.extractedPath : undefined)
  );
}

function runtimeArtifactInstallEntryEquals(
  left: RuntimeArtifactInstallStep,
  right: RuntimeArtifactInstallStep,
): boolean {
  if (left.op !== right.op) {
    return false;
  }

  if (left.op === "exec" && right.op === "exec") {
    return runtimeExecCommandEquals(left.command, right.command);
  }

  if (left.op === "mise_install" && right.op === "mise_install") {
    return (
      stringArrayEquals(left.tools, right.tools) &&
      left.force === right.force &&
      left.timeoutMs === right.timeoutMs
    );
  }

  if (left.op !== "github_release_install" || right.op !== "github_release_install") {
    return false;
  }

  if (!runtimeArtifactGitHubReleaseSelectorEquals(left.release, right.release)) {
    return false;
  }

  const assetEquals =
    left.asset.kind === "exact" && right.asset.kind === "exact"
      ? runtimeArtifactGitHubReleaseAssetShapeEquals(left.asset, right.asset)
      : left.asset.kind === "by_arch" && right.asset.kind === "by_arch"
        ? runtimeArtifactGitHubReleaseAssetShapeEquals(left.asset.x86_64, right.asset.x86_64) &&
          runtimeArtifactGitHubReleaseAssetShapeEquals(left.asset.aarch64, right.asset.aarch64)
        : false;

  return (
    left.repository === right.repository &&
    left.installPath === right.installPath &&
    left.timeoutMs === right.timeoutMs &&
    assetEquals
  );
}

function runtimeClientProcessReadinessEquals(
  left: RuntimeClientProcessSpec["readiness"],
  right: RuntimeClientProcessSpec["readiness"],
): boolean {
  if (left.type !== right.type) {
    return false;
  }

  if (left.type === "none" && right.type === "none") {
    return true;
  }

  if (left.type === "tcp" && right.type === "tcp") {
    return (
      left.host === right.host && left.port === right.port && left.timeoutMs === right.timeoutMs
    );
  }

  if (left.type === "ws" && right.type === "ws") {
    return left.url === right.url && left.timeoutMs === right.timeoutMs;
  }

  if (left.type === "http" && right.type === "http") {
    return (
      left.url === right.url &&
      left.expectedStatus === right.expectedStatus &&
      left.timeoutMs === right.timeoutMs
    );
  }

  return false;
}

function runtimeClientProcessStopPolicyEquals(
  left: RuntimeClientProcessSpec["stop"],
  right: RuntimeClientProcessSpec["stop"],
): boolean {
  return (
    left.signal === right.signal &&
    left.timeoutMs === right.timeoutMs &&
    left.gracePeriodMs === right.gracePeriodMs
  );
}

function runtimeClientProcessSpecEquals(
  left: RuntimeClientProcessSpec,
  right: RuntimeClientProcessSpec,
): boolean {
  return (
    runtimeExecCommandEquals(left.command, right.command) &&
    runtimeClientProcessReadinessEquals(left.readiness, right.readiness) &&
    runtimeClientProcessStopPolicyEquals(left.stop, right.stop)
  );
}

function runtimeClientEndpointSpecEquals(
  left: RuntimeClientEndpointSpec,
  right: RuntimeClientEndpointSpec,
): boolean {
  if (
    left.connectionMode !== right.connectionMode ||
    left.processKey !== right.processKey ||
    left.transport.type !== right.transport.type
  ) {
    return false;
  }

  if (left.transport.type === "ws" && right.transport.type === "ws") {
    return left.transport.url === right.transport.url;
  }

  return false;
}

function validateRuntimeClientProcess(input: {
  runtimeClientProcess: RuntimeClientProcessSpec;
  clientId: string;
}): void {
  const runtimeClientProcess = input.runtimeClientProcess;

  if (runtimeClientProcess.processKey.trim().length === 0) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
      `Runtime client process for client '${input.clientId}' must define a non-empty processKey.`,
    );
  }

  const commandArgs = runtimeClientProcess.command.args;
  if (commandArgs.length === 0) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
      `Runtime client process '${runtimeClientProcess.processKey}' for client '${input.clientId}' must define at least one command arg.`,
    );
  }
  const commandName = commandArgs[0];
  if (commandName === undefined || commandName.trim().length === 0) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
      `Runtime client process '${runtimeClientProcess.processKey}' for client '${input.clientId}' has an empty command name.`,
    );
  }

  const commandTimeoutMs = runtimeClientProcess.command.timeoutMs;
  if (commandTimeoutMs !== undefined && commandTimeoutMs <= 0) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
      `Runtime client process '${runtimeClientProcess.processKey}' for client '${input.clientId}' command timeoutMs must be greater than zero when provided.`,
    );
  }

  if (runtimeClientProcess.readiness.type === "tcp") {
    if (runtimeClientProcess.readiness.host.trim().length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process '${runtimeClientProcess.processKey}' for client '${input.clientId}' tcp readiness host must be non-empty.`,
      );
    }
    if (
      !Number.isInteger(runtimeClientProcess.readiness.port) ||
      runtimeClientProcess.readiness.port < 1 ||
      runtimeClientProcess.readiness.port > 65_535
    ) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process '${runtimeClientProcess.processKey}' for client '${input.clientId}' tcp readiness port must be an integer between 1 and 65535.`,
      );
    }
    if (runtimeClientProcess.readiness.timeoutMs <= 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process '${runtimeClientProcess.processKey}' for client '${input.clientId}' tcp readiness timeoutMs must be greater than zero.`,
      );
    }
  }

  if (runtimeClientProcess.readiness.type === "http") {
    try {
      new URL(runtimeClientProcess.readiness.url);
    } catch (error) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process '${runtimeClientProcess.processKey}' for client '${input.clientId}' http readiness url must be a valid URL.`,
        { cause: error },
      );
    }

    if (
      !Number.isInteger(runtimeClientProcess.readiness.expectedStatus) ||
      runtimeClientProcess.readiness.expectedStatus < 100 ||
      runtimeClientProcess.readiness.expectedStatus > 599
    ) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process '${runtimeClientProcess.processKey}' for client '${input.clientId}' http readiness expectedStatus must be an integer between 100 and 599.`,
      );
    }

    if (runtimeClientProcess.readiness.timeoutMs <= 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process '${runtimeClientProcess.processKey}' for client '${input.clientId}' http readiness timeoutMs must be greater than zero.`,
      );
    }
  }

  if (runtimeClientProcess.readiness.type === "ws") {
    let parsedURL: URL;
    try {
      parsedURL = new URL(runtimeClientProcess.readiness.url);
    } catch (error) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process '${runtimeClientProcess.processKey}' for client '${input.clientId}' ws readiness url must be a valid URL.`,
        { cause: error },
      );
    }

    if (parsedURL.protocol !== "ws:" && parsedURL.protocol !== "wss:") {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process '${runtimeClientProcess.processKey}' for client '${input.clientId}' ws readiness url must use ws or wss scheme.`,
      );
    }

    if (runtimeClientProcess.readiness.timeoutMs <= 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client process '${runtimeClientProcess.processKey}' for client '${input.clientId}' ws readiness timeoutMs must be greater than zero.`,
      );
    }
  }

  if (runtimeClientProcess.stop.timeoutMs <= 0) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
      `Runtime client process '${runtimeClientProcess.processKey}' for client '${input.clientId}' stop timeoutMs must be greater than zero.`,
    );
  }

  if (
    runtimeClientProcess.stop.gracePeriodMs !== undefined &&
    runtimeClientProcess.stop.gracePeriodMs < 0
  ) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
      `Runtime client process '${runtimeClientProcess.processKey}' for client '${input.clientId}' stop gracePeriodMs must be greater than or equal to zero when provided.`,
    );
  }
}

function validateRuntimeClientEndpoint(input: {
  runtimeClientEndpoint: RuntimeClientEndpointSpec;
  clientId: string;
}): void {
  const runtimeClientEndpoint = input.runtimeClientEndpoint;

  if (runtimeClientEndpoint.endpointKey.trim().length === 0) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
      `Runtime client endpoint for client '${input.clientId}' must define a non-empty endpointKey.`,
    );
  }

  if (
    runtimeClientEndpoint.processKey !== undefined &&
    runtimeClientEndpoint.processKey.trim().length === 0
  ) {
    throw new IntegrationCompilerError(
      CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
      `Runtime client endpoint '${runtimeClientEndpoint.endpointKey}' for client '${input.clientId}' must define a non-empty processKey when provided.`,
    );
  }

  if (runtimeClientEndpoint.transport.type === "ws") {
    let parsedURL: URL;
    try {
      parsedURL = new URL(runtimeClientEndpoint.transport.url);
    } catch (error) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client endpoint '${runtimeClientEndpoint.endpointKey}' for client '${input.clientId}' ws transport url must be a valid URL.`,
        { cause: error },
      );
    }

    if (parsedURL.protocol !== "ws:" && parsedURL.protocol !== "wss:") {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        `Runtime client endpoint '${runtimeClientEndpoint.endpointKey}' for client '${input.clientId}' ws transport url must use ws or wss scheme.`,
      );
    }
  }
}

function validateRuntimeClients(input: ReadonlyArray<CompiledRuntimeClient>): void {
  const clientEnvByClientId = new Map<string, Map<string, string>>();
  const clientFilesByPathByClientId = new Map<
    string,
    Map<string, { fileId: string; mode: number; content: string; writeMode?: RuntimeFileWriteMode }>
  >();
  const clientFilesByIdByClientId = new Map<
    string,
    Map<string, { path: string; mode: number; content: string; writeMode?: RuntimeFileWriteMode }>
  >();
  const clientProcessesByKey = new Map<string, Map<string, RuntimeClientProcessSpec>>();
  const clientEndpointsByKey = new Map<string, Map<string, RuntimeClientEndpointSpec>>();

  for (const runtimeClient of input) {
    if (runtimeClient.clientId.trim().length === 0) {
      throw new IntegrationCompilerError(
        CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
        "Runtime client must define a non-empty clientId.",
      );
    }

    let envByKey = clientEnvByClientId.get(runtimeClient.clientId);
    if (envByKey === undefined) {
      envByKey = new Map();
      clientEnvByClientId.set(runtimeClient.clientId, envByKey);
    }

    for (const [envKey, envValue] of Object.entries(runtimeClient.setup.env)) {
      const existingValue = envByKey.get(envKey);
      if (existingValue !== undefined && existingValue !== envValue) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client env conflict for client '${runtimeClient.clientId}' and key '${envKey}'.`,
        );
      }

      envByKey.set(envKey, envValue);
    }

    let filesByPath = clientFilesByPathByClientId.get(runtimeClient.clientId);
    if (filesByPath === undefined) {
      filesByPath = new Map();
      clientFilesByPathByClientId.set(runtimeClient.clientId, filesByPath);
    }

    let filesById = clientFilesByIdByClientId.get(runtimeClient.clientId);
    if (filesById === undefined) {
      filesById = new Map();
      clientFilesByIdByClientId.set(runtimeClient.clientId, filesById);
    }

    for (const file of runtimeClient.setup.files) {
      const existingFileByPath = filesByPath.get(file.path);
      if (
        existingFileByPath !== undefined &&
        (existingFileByPath.fileId !== file.fileId ||
          existingFileByPath.mode !== file.mode ||
          existingFileByPath.content !== file.content ||
          existingFileByPath.writeMode !== file.writeMode)
      ) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client file conflict for client '${runtimeClient.clientId}' and path '${file.path}'.`,
        );
      }

      const existingFileById = filesById.get(file.fileId);
      if (
        existingFileById !== undefined &&
        (existingFileById.path !== file.path ||
          existingFileById.mode !== file.mode ||
          existingFileById.content !== file.content ||
          existingFileById.writeMode !== file.writeMode)
      ) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client file conflict for client '${runtimeClient.clientId}' and fileId '${file.fileId}'.`,
        );
      }

      filesByPath.set(file.path, {
        fileId: file.fileId,
        mode: file.mode,
        content: file.content,
        ...(file.writeMode === undefined ? {} : { writeMode: file.writeMode }),
      });
      filesById.set(file.fileId, {
        path: file.path,
        mode: file.mode,
        content: file.content,
        ...(file.writeMode === undefined ? {} : { writeMode: file.writeMode }),
      });
    }

    let processesByKey = clientProcessesByKey.get(runtimeClient.clientId);
    if (processesByKey === undefined) {
      processesByKey = new Map();
      clientProcessesByKey.set(runtimeClient.clientId, processesByKey);
    }

    for (const runtimeClientProcess of runtimeClient.processes) {
      validateRuntimeClientProcess({
        runtimeClientProcess,
        clientId: runtimeClient.clientId,
      });

      const existingProcess = processesByKey.get(runtimeClientProcess.processKey);
      if (existingProcess === undefined) {
        processesByKey.set(runtimeClientProcess.processKey, runtimeClientProcess);
        continue;
      }

      if (!runtimeClientProcessSpecEquals(existingProcess, runtimeClientProcess)) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client process key conflict for client '${runtimeClient.clientId}' and process '${runtimeClientProcess.processKey}'.`,
        );
      }
    }

    let endpointsByKey = clientEndpointsByKey.get(runtimeClient.clientId);
    if (endpointsByKey === undefined) {
      endpointsByKey = new Map();
      clientEndpointsByKey.set(runtimeClient.clientId, endpointsByKey);
    }

    for (const runtimeClientEndpoint of runtimeClient.endpoints) {
      validateRuntimeClientEndpoint({
        runtimeClientEndpoint,
        clientId: runtimeClient.clientId,
      });

      const existingEndpoint = endpointsByKey.get(runtimeClientEndpoint.endpointKey);
      if (existingEndpoint === undefined) {
        endpointsByKey.set(runtimeClientEndpoint.endpointKey, runtimeClientEndpoint);
        continue;
      }

      if (!runtimeClientEndpointSpecEquals(existingEndpoint, runtimeClientEndpoint)) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client endpoint key conflict for client '${runtimeClient.clientId}' and endpoint '${runtimeClientEndpoint.endpointKey}'.`,
        );
      }
    }
  }

  for (const [clientId, endpointsByKey] of clientEndpointsByKey.entries()) {
    const processesByKey = clientProcessesByKey.get(clientId) ?? new Map();

    for (const runtimeClientEndpoint of endpointsByKey.values()) {
      if (runtimeClientEndpoint.processKey === undefined) {
        continue;
      }

      if (!processesByKey.has(runtimeClientEndpoint.processKey)) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
          `Runtime client endpoint '${runtimeClientEndpoint.endpointKey}' references missing process '${runtimeClientEndpoint.processKey}' for client '${clientId}'.`,
        );
      }
    }
  }
}

function validateAgentRuntimes(input: {
  compiledBindingResults: ReadonlyArray<CompiledBindingResult>;
}): void {
  for (const compiledBindingResult of input.compiledBindingResults) {
    const endpointKeysByClientId = new Map<string, Set<string>>();
    const runtimeKeys = new Set<string>();

    for (const runtimeClient of compiledBindingResult.runtimeClients) {
      let endpointKeys = endpointKeysByClientId.get(runtimeClient.clientId);
      if (endpointKeys === undefined) {
        endpointKeys = new Set<string>();
        endpointKeysByClientId.set(runtimeClient.clientId, endpointKeys);
      }

      for (const endpoint of runtimeClient.endpoints) {
        endpointKeys.add(endpoint.endpointKey);
      }
    }

    for (const agentRuntime of compiledBindingResult.agentRuntimes) {
      if (agentRuntime.runtimeKey.trim().length === 0) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
          `Agent runtime for binding '${agentRuntime.bindingId}' must define a non-empty runtimeKey.`,
        );
      }

      if (runtimeKeys.has(agentRuntime.runtimeKey)) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
          `Duplicate agent runtime key '${agentRuntime.runtimeKey}' detected for binding '${agentRuntime.bindingId}'.`,
        );
      }
      runtimeKeys.add(agentRuntime.runtimeKey);

      if (agentRuntime.runtimeId.trim().length === 0) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
          `Agent runtime '${agentRuntime.runtimeKey}' for binding '${agentRuntime.bindingId}' must define a non-empty runtimeId.`,
        );
      }

      if (agentRuntime.clientId.trim().length === 0) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
          `Agent runtime '${agentRuntime.runtimeKey}' for binding '${agentRuntime.bindingId}' must define a non-empty clientId.`,
        );
      }

      const endpointKeys = endpointKeysByClientId.get(agentRuntime.clientId);
      if (endpointKeys === undefined) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
          `Agent runtime '${agentRuntime.runtimeKey}' for binding '${agentRuntime.bindingId}' references missing runtime client '${agentRuntime.clientId}'.`,
        );
      }

      if (agentRuntime.endpointKey.trim().length === 0) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
          `Agent runtime '${agentRuntime.runtimeKey}' for binding '${agentRuntime.bindingId}' must define a non-empty endpointKey.`,
        );
      }

      if (!endpointKeys.has(agentRuntime.endpointKey)) {
        throw new IntegrationCompilerError(
          CompilerErrorCodes.AGENT_RUNTIME_CONFLICT,
          `Agent runtime '${agentRuntime.runtimeKey}' for binding '${agentRuntime.bindingId}' references missing endpoint '${agentRuntime.endpointKey}' on client '${agentRuntime.clientId}'.`,
        );
      }

      validateAgentPtyLaunch({
        bindingId: agentRuntime.bindingId,
        runtimeKey: agentRuntime.runtimeKey,
        runtimeId: agentRuntime.runtimeId,
        ptyLaunch: agentRuntime.ptyLaunch,
      });
    }
  }
}

export function validateCompiledBindingResults(input: {
  compiledBindingResults: ReadonlyArray<CompiledBindingResult>;
}): void {
  const flattenedResults = flattenCompiledBindingResults(input.compiledBindingResults);

  validateRoutes(flattenedResults.egressRoutes);
  validateArtifacts(flattenedResults.artifacts);
  validateWorkspaceSources(flattenedResults.workspaceSources);
  validateRuntimeClients(flattenedResults.runtimeClients);
  validateAgentRuntimes({
    compiledBindingResults: input.compiledBindingResults,
  });
}
