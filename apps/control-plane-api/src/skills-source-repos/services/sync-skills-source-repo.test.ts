import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  buildSkillsSourceRepoDiscoveryRuntimePlan,
  parseSkillsDiscoverCommandOutput,
} from "./sync-skills-source-repo.js";

describe("skills source repo sync service", () => {
  it("narrows a compiled runtime plan to the selected skills source repository", () => {
    const runtimePlan = createRuntimePlan();

    const discoveryPlan = buildSkillsSourceRepoDiscoveryRuntimePlan({
      runtimePlan,
      originUrl: "https://github.com/acme/skills.git",
    });

    expect(discoveryPlan).toEqual({
      sandboxProfileId: "sbp_skills_sync",
      version: 1,
      image: {
        source: "base",
        imageRef: "ubuntu:24.04",
      },
      egressRoutes: runtimePlan.egressRoutes,
      artifacts: [],
      workspaceSources: [
        {
          sourceKind: "git-clone",
          resourceKind: "repository",
          path: "/root/acme/skills",
          originUrl: "https://github.com/acme/skills.git",
        },
      ],
      runtimeClients: [],
      agentRuntimes: [],
    });
  });

  it("keeps only selected repository credential egress for skills discovery", () => {
    const runtimePlan = createRuntimePlan({
      egressRoutes: [
        {
          egressRuleId: "egress_rule_github_git",
          bindingId: "ibd_github",
          familyId: "github",
          variantId: "github-cloud",
          match: {
            hosts: ["github.com"],
            pathPrefixes: ["/acme/skills.git", "/acme/app.git"],
            methods: ["GET", "POST"],
          },
          upstream: {
            baseUrl: "https://github.com",
          },
          authInjection: {
            type: "basic",
            target: "authorization",
            username: "x-access-token",
          },
          credentialResolver: {
            kind: "integration_connection",
            connectionId: "icn_github",
            secretType: "github.installation-token",
          },
        },
        {
          egressRuleId: "egress_rule_github_api",
          bindingId: "ibd_github_api",
          familyId: "github",
          variantId: "github-cloud",
          match: {
            hosts: ["api.github.com"],
          },
          upstream: {
            baseUrl: "https://api.github.com",
          },
          authInjection: {
            type: "bearer",
            target: "authorization",
          },
          credentialResolver: {
            kind: "integration_connection",
            connectionId: "icn_github",
            secretType: "github.installation-token",
          },
        },
      ],
    });

    const discoveryPlan = buildSkillsSourceRepoDiscoveryRuntimePlan({
      runtimePlan,
      originUrl: "https://github.com/acme/skills.git",
    });

    expect(discoveryPlan.egressRoutes).toEqual([
      {
        egressRuleId: "egress_rule_github_git",
        bindingId: "ibd_github",
        familyId: "github",
        variantId: "github-cloud",
        match: {
          hosts: ["github.com"],
          pathPrefixes: ["/acme/skills.git"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://github.com",
        },
        authInjection: {
          type: "basic",
          target: "authorization",
          username: "x-access-token",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_github",
          secretType: "github.installation-token",
        },
      },
    ]);
  });

  it("fails when the selected skills source repository is absent from the runtime plan", () => {
    expect(() =>
      buildSkillsSourceRepoDiscoveryRuntimePlan({
        runtimePlan: createRuntimePlan(),
        originUrl: "https://github.com/acme/missing.git",
      }),
    ).toThrow(
      "Runtime plan does not include skills source repo 'https://github.com/acme/missing.git'.",
    );
  });

  it("parses sandboxd skills discover JSON output", () => {
    const output = parseSkillsDiscoverCommandOutput(
      JSON.stringify({
        commitSha: "0123456789abcdef",
        skills: [
          {
            name: "github-pr-authoring",
            description: "Draft pull requests.",
            relativePath: ".agents/skills/github-pr-authoring",
          },
        ],
      }),
    );

    expect(output).toEqual({
      commitSha: "0123456789abcdef",
      skills: [
        {
          name: "github-pr-authoring",
          description: "Draft pull requests.",
          relativePath: ".agents/skills/github-pr-authoring",
        },
      ],
    });
  });
});

function createRuntimePlan(
  input: { egressRoutes?: CompiledRuntimePlan["egressRoutes"] } = {},
): CompiledRuntimePlan {
  return {
    sandboxProfileId: "sbp_skills_sync",
    version: 1,
    image: {
      source: "base",
      imageRef: "ubuntu:24.04",
    },
    egressRoutes: input.egressRoutes ?? [
      {
        egressRuleId: "egress_rule_github_git",
        bindingId: "ibd_github",
        familyId: "github",
        variantId: "github-cloud",
        match: {
          hosts: ["github.com"],
          pathPrefixes: ["/acme/skills.git"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://github.com",
        },
        authInjection: {
          type: "basic",
          target: "authorization",
          username: "x-access-token",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_github",
          secretType: "github.installation-token",
        },
      },
    ],
    artifacts: [
      {
        artifactKey: "unused",
        name: "Unused",
        env: {},
        lifecycle: {
          install: [],
        },
      },
    ],
    workspaceSources: [
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: "/root/acme/skills",
        originUrl: "https://github.com/acme/skills.git",
      },
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: "/root/acme/app",
        originUrl: "https://github.com/acme/app.git",
      },
    ],
    runtimeClients: [],
    agentRuntimes: [],
  };
}
