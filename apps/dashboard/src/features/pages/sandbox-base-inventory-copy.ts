import SandboxBaseInventory from "../../../../../packages/sandboxd/sandbox-base-inventory.generated.json" with { type: "json" };

type SandboxBaseInventoryRuntimeBase = Pick<
  typeof SandboxBaseInventory.runtimeBase,
  "packageManagers" | "shell" | "user" | "workingDirectory"
> & {
  os: {
    prettyName: string;
  };
};

type SandboxBaseInventoryTool = (typeof SandboxBaseInventory.tools)[number];

type SandboxBaseInventoryPresentationInput = {
  repositoryHandles?: readonly string[];
  runtimeBase: SandboxBaseInventoryRuntimeBase;
  tools: readonly SandboxBaseInventoryTool[];
};

type SandboxBaseRepositoryBindingInput = {
  config: Record<string, unknown>;
  kind: string;
};

type SandboxBaseSetupContextGroup = {
  id: string;
  title: string;
  rows: readonly SandboxBaseSetupContextRow[];
};

type SandboxBaseSetupContextRow = {
  id: string;
  label: string;
  value: string;
  valueKind: "path" | "text" | "version";
};

type SetupScriptRepositoryLocationExample = {
  handle: string;
  path: string;
};

type SandboxBaseSetupScriptContext = {
  environmentAndToolGroups: readonly SandboxBaseSetupContextGroup[];
  repositoryLocationExample: SetupScriptRepositoryLocationExample;
  repositoryLocationGroup: SandboxBaseSetupContextGroup | null;
};

type MutableSandboxBaseSetupContextGroup = {
  id: string;
  title: string;
  rows: SandboxBaseSetupContextRow[];
};

function readPrimaryPackageManager(input: SandboxBaseInventoryRuntimeBase): string {
  const packageManager = input.packageManagers[0];

  if (packageManager === undefined) {
    throw new Error("Expected sandbox base inventory to include at least one package manager.");
  }

  return packageManager;
}

function createExecutionEnvironmentRows(
  input: SandboxBaseInventoryRuntimeBase,
): readonly SandboxBaseSetupContextRow[] {
  return [
    {
      id: "os",
      label: "OS",
      value: input.os.prettyName,
      valueKind: "text",
    },
    {
      id: "user",
      label: "User",
      value: `${input.user.name} (uid ${String(input.user.uid)})`,
      valueKind: "text",
    },
    {
      id: "shell",
      label: "Shell",
      value: input.shell,
      valueKind: "text",
    },
    {
      id: "working-directory",
      label: "Working directory",
      value: input.workingDirectory,
      valueKind: "text",
    },
    {
      id: "package-manager",
      label: "Package manager",
      value: readPrimaryPackageManager(input),
      valueKind: "text",
    },
  ];
}

function createToolContextGroups(
  tools: readonly SandboxBaseInventoryTool[],
): readonly SandboxBaseSetupContextGroup[] {
  const groups: MutableSandboxBaseSetupContextGroup[] = [];

  for (const tool of tools) {
    let group = groups.find((candidate) => candidate.id === tool.category.id);

    if (group === undefined) {
      group = {
        id: tool.category.id,
        rows: [],
        title: tool.category.title,
      };
      groups.push(group);
    }

    group.rows.push({
      id: tool.command,
      label: tool.displayName,
      value: tool.version,
      valueKind: "version",
    });
  }

  return groups;
}

function createRepositoryPath(workingDirectory: string, repositoryHandle: string): string {
  const root = workingDirectory.endsWith("/") ? workingDirectory.slice(0, -1) : workingDirectory;

  return `${root}/${repositoryHandle}`;
}

function createRepositoryLocationGroup(
  repositoryHandles: readonly string[] | undefined,
  workingDirectory: string,
): SandboxBaseSetupContextGroup | null {
  if (repositoryHandles === undefined || repositoryHandles.length === 0) {
    return null;
  }

  return {
    id: "repository-locations",
    title: "Repository locations",
    rows: repositoryHandles.map(
      (repositoryHandle): SandboxBaseSetupContextRow => ({
        id: `repository-${repositoryHandle}`,
        label: repositoryHandle,
        value: createRepositoryPath(workingDirectory, repositoryHandle),
        valueKind: "path",
      }),
    ),
  };
}

export function createSandboxBaseSetupScriptContext(
  input: SandboxBaseInventoryPresentationInput,
): SandboxBaseSetupScriptContext {
  const repositoryLocationGroup = createRepositoryLocationGroup(
    input.repositoryHandles,
    input.runtimeBase.workingDirectory,
  );

  return {
    environmentAndToolGroups: [
      {
        id: "execution-environment",
        title: "Execution environment",
        rows: createExecutionEnvironmentRows(input.runtimeBase),
      },
      ...createToolContextGroups(input.tools),
    ],
    repositoryLocationExample: createSetupScriptRepositoryLocationExample(
      input.runtimeBase.workingDirectory,
      input.repositoryHandles,
    ),
    repositoryLocationGroup,
  };
}

function createSetupScriptRepositoryLocationExample(
  workingDirectory: string,
  repositoryHandles?: readonly string[],
): SetupScriptRepositoryLocationExample {
  const handle = repositoryHandles?.[0] ?? "acme/web";

  return {
    handle,
    path: createRepositoryPath(workingDirectory, handle),
  };
}

export function createSandboxBaseSetupScriptContextFromGeneratedInventory(
  repositoryHandles?: readonly string[],
): SandboxBaseSetupScriptContext {
  return createSandboxBaseSetupScriptContext({
    runtimeBase: SandboxBaseInventory.runtimeBase,
    tools: SandboxBaseInventory.tools,
    ...(repositoryHandles === undefined ? {} : { repositoryHandles }),
  });
}

export function resolveSandboxBaseRepositoryHandles(
  bindings: readonly SandboxBaseRepositoryBindingInput[] | null,
): readonly string[] {
  if (bindings === null) {
    return [];
  }

  const handles: string[] = [];
  const seenHandles = new Set<string>();

  for (const binding of bindings) {
    if (binding.kind !== "git") {
      continue;
    }

    const repositories = binding.config["repositories"];
    if (!Array.isArray(repositories)) {
      continue;
    }

    for (const repository of repositories) {
      if (typeof repository !== "string" || seenHandles.has(repository)) {
        continue;
      }

      seenHandles.add(repository);
      handles.push(repository);
    }
  }

  return handles;
}

export const SetupScriptTimingDescription =
  "Runs once during sandbox setup after repositories, resources, and CLI tools are ready. Use it for project bootstrap steps such as dependency install, local config generation, or repo-specific setup commands.";
