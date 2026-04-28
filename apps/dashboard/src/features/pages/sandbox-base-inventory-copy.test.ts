import { describe, expect, it } from "vitest";

import {
  createSandboxBasePreinstalledToolGroups,
  createSandboxBaseRuntimeEnvironmentItems,
  createSandboxBaseSetupContextGroups,
  resolveSandboxBaseRepositoryHandles,
} from "./sandbox-base-inventory-copy.js";

const TestToolCategories = {
  RUNTIMES: {
    id: "runtimes",
    title: "Runtimes",
  },
  CONTAINERS: {
    id: "containers",
    title: "Containers",
  },
} satisfies Record<string, { id: string; title: string }>;

describe("sandbox base inventory copy", () => {
  it("builds execution environment items from generated runtime base data", () => {
    expect(
      createSandboxBaseRuntimeEnvironmentItems({
        os: {
          prettyName: "Debian GNU/Linux 12 (bookworm)",
        },
        packageManagers: ["apt-get", "apt"],
        shell: "/bin/bash",
        user: {
          name: "root",
          uid: 0,
        },
        workingDirectory: "/root",
      }),
    ).toEqual([
      {
        id: "os",
        label: "OS",
        value: "Debian GNU/Linux 12 (bookworm)",
      },
      {
        id: "user",
        label: "User",
        value: "root (uid 0)",
      },
      {
        id: "shell",
        label: "Shell",
        value: "/bin/bash",
      },
      {
        id: "working-directory",
        label: "Working directory",
        value: "/root",
      },
      {
        id: "package-manager",
        label: "Package manager",
        value: "apt-get",
      },
    ]);
  });

  it("groups preinstalled tools by generated inventory category", () => {
    expect(
      createSandboxBasePreinstalledToolGroups([
        {
          category: TestToolCategories.RUNTIMES,
          command: "node",
          displayName: "Node.js",
          version: "24.14.1",
        },
        {
          category: TestToolCategories.RUNTIMES,
          command: "python3",
          displayName: "Python",
          version: "3.14.4",
        },
        {
          category: TestToolCategories.CONTAINERS,
          command: "docker",
          displayName: "Docker",
          version: "29.3.1",
        },
      ]),
    ).toEqual([
      {
        id: "runtimes",
        title: "Runtimes",
        tools: [
          {
            id: "node",
            name: "Node.js",
            version: "24.14.1",
          },
          {
            id: "python3",
            name: "Python",
            version: "3.14.4",
          },
        ],
      },
      {
        id: "containers",
        title: "Containers",
        tools: [
          {
            id: "docker",
            name: "Docker",
            version: "29.3.1",
          },
        ],
      },
    ]);
  });

  it("combines execution environment and preinstalled tools into one presentation group list", () => {
    expect(
      createSandboxBaseSetupContextGroups({
        runtimeBase: {
          os: {
            prettyName: "Debian GNU/Linux 12 (bookworm)",
          },
          packageManagers: ["apt-get", "apt"],
          shell: "/bin/bash",
          user: {
            name: "root",
            uid: 0,
          },
          workingDirectory: "/root",
        },
        repositoryHandles: ["mistlehq/mistle"],
        tools: [
          {
            category: TestToolCategories.RUNTIMES,
            command: "node",
            displayName: "Node.js",
            version: "24.14.1",
          },
          {
            category: TestToolCategories.CONTAINERS,
            command: "docker",
            displayName: "Docker",
            version: "29.3.1",
          },
        ],
      }),
    ).toEqual([
      {
        id: "execution-environment",
        title: "Execution environment",
        rows: [
          {
            id: "os",
            label: "OS",
            value: "Debian GNU/Linux 12 (bookworm)",
            valueKind: "text",
          },
          {
            id: "user",
            label: "User",
            value: "root (uid 0)",
            valueKind: "text",
          },
          {
            id: "shell",
            label: "Shell",
            value: "/bin/bash",
            valueKind: "text",
          },
          {
            id: "working-directory",
            label: "Working directory",
            value: "/root",
            valueKind: "text",
          },
          {
            id: "package-manager",
            label: "Package manager",
            value: "apt-get",
            valueKind: "text",
          },
        ],
      },
      {
        id: "repository-locations",
        title: "Repository locations",
        rows: [
          {
            id: "repository-mistlehq/mistle",
            label: "mistlehq/mistle",
            value: "/root/mistlehq/mistle",
            valueKind: "path",
          },
        ],
      },
      {
        id: "runtimes",
        title: "Runtimes",
        rows: [
          {
            id: "node",
            label: "Node.js",
            value: "24.14.1",
            valueKind: "version",
          },
        ],
      },
      {
        id: "containers",
        title: "Containers",
        rows: [
          {
            id: "docker",
            label: "Docker",
            value: "29.3.1",
            valueKind: "version",
          },
        ],
      },
    ]);
  });

  it("resolves unique repository handles from git bindings", () => {
    expect(
      resolveSandboxBaseRepositoryHandles([
        {
          kind: "agent",
          config: {
            repositories: ["ignored/agent"],
          },
        },
        {
          kind: "git",
          config: {
            repositories: ["mistlehq/mistle", "mistlehq/mistle", "mistlehq/dashboard", 42],
          },
        },
        {
          kind: "git",
          config: {},
        },
      ]),
    ).toEqual(["mistlehq/mistle", "mistlehq/dashboard"]);
  });
});
