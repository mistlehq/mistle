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
  repositoryHandles?: readonly string[] | undefined;
  runtimeBase: SandboxBaseInventoryRuntimeBase;
  tools: readonly SandboxBaseInventoryTool[];
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
  input: Pick<SandboxBaseInventoryPresentationInput, "tools">,
): readonly SandboxBasePreinstalledToolGroup[] {
  const groups: MutableSandboxBasePreinstalledToolGroup[] = [];

  for (const tool of input.tools) {
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

function createRepositoryPath(input: {
  workingDirectory: string;
  repositoryHandle: string;
}): string {
  const root = input.workingDirectory.endsWith("/")
    ? input.workingDirectory.slice(0, -1)
    : input.workingDirectory;

  return `${root}/${input.repositoryHandle}`;
}

function createRepositoryLocationGroup(
  input: Pick<SandboxBaseInventoryPresentationInput, "repositoryHandles" | "runtimeBase">,
): SandboxBaseSetupContextGroup | null {
  const repositoryHandles = input.repositoryHandles ?? [];

  if (repositoryHandles.length === 0) {
    return null;
  }

  return {
    id: "repository-locations",
    title: "Repository locations",
    rows: repositoryHandles.map(
      (repositoryHandle): SandboxBaseSetupContextRow => ({
        id: `repository-${repositoryHandle}`,
        label: repositoryHandle,
        value: createRepositoryPath({
          repositoryHandle,
          workingDirectory: input.runtimeBase.workingDirectory,
        }),
        valueKind: "path",
      }),
    ),
  };
}

export function createSandboxBaseSetupContextGroups(
  input: SandboxBaseInventoryPresentationInput,
): readonly SandboxBaseSetupContextGroup[] {
  const repositoryLocationGroup = createRepositoryLocationGroup(input);
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
    ...createSandboxBasePreinstalledToolGroups(input).map((group) => ({
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

export function createSandboxBaseSetupContextGroupsFromGeneratedInventory(input: {
  repositoryHandles?: readonly string[] | undefined;
}): readonly SandboxBaseSetupContextGroup[] {
  return createSandboxBaseSetupContextGroups({
    ...SandboxBaseInventory,
    ...(input.repositoryHandles === undefined
      ? {}
      : { repositoryHandles: input.repositoryHandles }),
  });
}

export function createSetupScriptRepositoryLocationExample(input: {
  repositoryHandles?: readonly string[] | undefined;
  workingDirectory: string;
}): SetupScriptRepositoryLocationExample {
  const handle = input.repositoryHandles?.[0] ?? "acme/web";

  return {
    handle,
    path: createRepositoryPath({
      repositoryHandle: handle,
      workingDirectory: input.workingDirectory,
    }),
  };
}

export function createSetupScriptRepositoryLocationExampleFromGeneratedInventory(input: {
  repositoryHandles?: readonly string[] | undefined;
}): SetupScriptRepositoryLocationExample {
  return createSetupScriptRepositoryLocationExample({
    repositoryHandles: input.repositoryHandles ?? [],
    workingDirectory: SandboxBaseInventory.runtimeBase.workingDirectory,
  });
}

export function createSetupScriptRepositoryLocationDescription(input: {
  repositoryHandles?: readonly string[] | undefined;
  workingDirectory: string;
}): string {
  const example = createSetupScriptRepositoryLocationExample(input);

  return `Repositories are cloned under the working directory, using their owner/repository path. For example, ${example.handle} is available at ${example.path}.`;
}

export function createSetupScriptRepositoryLocationDescriptionFromGeneratedInventory(input: {
  repositoryHandles?: readonly string[] | undefined;
}): string {
  return createSetupScriptRepositoryLocationDescription({
    repositoryHandles: input.repositoryHandles ?? [],
    workingDirectory: SandboxBaseInventory.runtimeBase.workingDirectory,
  });
}

export const SetupScriptTimingDescription =
  "Runs once during sandbox setup after repositories, resources, and CLI tools are ready. Use it for project bootstrap steps such as dependency install, local config generation, or repo-specific setup commands.";
export const SetupScriptRepositoryLocationDescription =
  createSetupScriptRepositoryLocationDescriptionFromGeneratedInventory({});

export const SandboxBaseRuntimeEnvironmentItems = createSandboxBaseRuntimeEnvironmentItems(
  SandboxBaseInventory.runtimeBase,
);
export const SandboxBasePreinstalledToolGroups =
  createSandboxBasePreinstalledToolGroups(SandboxBaseInventory);
export const SandboxBaseSetupContextGroups =
  createSandboxBaseSetupContextGroupsFromGeneratedInventory({});
