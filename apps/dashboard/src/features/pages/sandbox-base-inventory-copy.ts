import SandboxBaseInventory from "../../../../../packages/sandboxd/sandbox-base-inventory.generated.json" with { type: "json" };

type SandboxBaseInventoryTool = {
  category: SandboxBaseInventoryToolCategory;
  command: string;
  displayName: string;
  version: string;
};

type SandboxBaseInventoryToolCategory = {
  id: string;
  title: string;
};

type SandboxBaseInventoryRuntimeBase = {
  os: {
    prettyName: string;
  };
  packageManagers: readonly string[];
  shell: string;
  user: {
    name: string;
    uid: number;
  };
  workingDirectory: string;
};

type SandboxBaseInventoryPresentationInput = {
  repositoryHandles?: readonly string[];
  runtimeBase: SandboxBaseInventoryRuntimeBase;
  tools: readonly SandboxBaseInventoryTool[];
};

type SandboxBaseRepositoryBindingInput = {
  config: Record<string, unknown>;
  kind: string;
};

type SandboxBaseRuntimeEnvironmentItem = {
  id: string;
  label: string;
  value: string;
};

type SandboxBasePreinstalledToolItem = {
  id: string;
  name: string;
  version: string;
};

type SandboxBasePreinstalledToolGroup = {
  id: string;
  title: string;
  tools: readonly SandboxBasePreinstalledToolItem[];
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

type MutableSandboxBasePreinstalledToolGroup = {
  id: string;
  title: string;
  tools: SandboxBasePreinstalledToolItem[];
};

function readPrimaryPackageManager(input: SandboxBaseInventoryRuntimeBase): string {
  const packageManager = input.packageManagers[0];

  if (packageManager === undefined) {
    throw new Error("Expected sandbox base inventory to include at least one package manager.");
  }

  return packageManager;
}

export function createSandboxBaseRuntimeEnvironmentItems(
  input: SandboxBaseInventoryRuntimeBase,
): readonly SandboxBaseRuntimeEnvironmentItem[] {
  return [
    {
      id: "os",
      label: "OS",
      value: input.os.prettyName,
    },
    {
      id: "user",
      label: "User",
      value: `${input.user.name} (uid ${String(input.user.uid)})`,
    },
    {
      id: "shell",
      label: "Shell",
      value: input.shell,
    },
    {
      id: "working-directory",
      label: "Working directory",
      value: input.workingDirectory,
    },
    {
      id: "package-manager",
      label: "Package manager",
      value: readPrimaryPackageManager(input),
    },
  ];
}

export function createSandboxBasePreinstalledToolGroups(
  tools: readonly SandboxBaseInventoryTool[],
): readonly SandboxBasePreinstalledToolGroup[] {
  const groups: MutableSandboxBasePreinstalledToolGroup[] = [];

  for (const tool of tools) {
    let group = groups.find((candidate) => candidate.id === tool.category.id);

    if (group === undefined) {
      group = {
        id: tool.category.id,
        title: tool.category.title,
        tools: [],
      };
      groups.push(group);
    }

    group.tools.push({
      id: tool.command,
      name: tool.displayName,
      version: tool.version,
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

export function createSandboxBaseSetupContextGroups(
  input: SandboxBaseInventoryPresentationInput,
): readonly SandboxBaseSetupContextGroup[] {
  const repositoryLocationGroup = createRepositoryLocationGroup(
    input.repositoryHandles,
    input.runtimeBase.workingDirectory,
  );
  const groups: SandboxBaseSetupContextGroup[] = [
    {
      id: "execution-environment",
      title: "Execution environment",
      rows: createSandboxBaseRuntimeEnvironmentItems(input.runtimeBase).map(
        (item): SandboxBaseSetupContextRow => ({
          id: item.id,
          label: item.label,
          value: item.value,
          valueKind: "text",
        }),
      ),
    },
  ];

  if (repositoryLocationGroup !== null) {
    groups.push(repositoryLocationGroup);
  }

  groups.push(
    ...createSandboxBasePreinstalledToolGroups(input.tools).map((group) => ({
      id: group.id,
      title: group.title,
      rows: group.tools.map(
        (tool): SandboxBaseSetupContextRow => ({
          id: tool.id,
          label: tool.name,
          value: tool.version,
          valueKind: "version",
        }),
      ),
    })),
  );

  return groups;
}

export function createSandboxBaseSetupContextGroupsFromGeneratedInventory(
  repositoryHandles?: readonly string[],
): readonly SandboxBaseSetupContextGroup[] {
  return createSandboxBaseSetupContextGroups({
    runtimeBase: SandboxBaseInventory.runtimeBase,
    tools: SandboxBaseInventory.tools,
    ...(repositoryHandles === undefined ? {} : { repositoryHandles }),
  });
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

export function createSetupScriptRepositoryLocationExampleFromGeneratedInventory(
  repositoryHandles?: readonly string[],
): SetupScriptRepositoryLocationExample {
  return createSetupScriptRepositoryLocationExample(
    SandboxBaseInventory.runtimeBase.workingDirectory,
    repositoryHandles,
  );
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
