/* eslint-disable jest/no-standalone-expect --
 * This suite uses the extended `it` fixture from the shared system-test context.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  organizationIdentityLinkProviderConfigs,
  OrganizationIdentityLinkProviderConfigStatus,
  userExternalPrincipals,
  userExternalPrincipalCredentials,
  UserExternalPrincipalCredentialStatuses,
  UserExternalPrincipalStatuses,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  prepareCodexSandbox,
  runSandboxExecCommandInSandbox,
  stopSandboxInstance,
  waitForSandboxConnectable,
  waitForSandboxStatus,
} from "./helpers/codex-sandbox.js";
import { it, type SystemTestFixture } from "./system-test-context.js";

const execFileAsync = promisify(execFile);
const InternalAuthServiceTokenHeader = "x-mistle-service-token";
const SystemSandboxProvider = {
  DOCKER: "docker",
  E2B: "e2b",
} as const;
const requestedSystemSandboxProvider =
  process.env.MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER ?? SystemSandboxProvider.DOCKER;
const itForE2B = requestedSystemSandboxProvider === SystemSandboxProvider.E2B ? it : it.skip;
const TestTimeoutMs = 10 * 60_000;
const GitHubAppInstallationConnectionMethodId = "github-app-installation";

const InternalMintConnectionTokenResponseSchema = z
  .object({
    instanceId: z.string().min(1),
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

describe("system internal mint connection token restores git signing", () => {
  itForE2B(
    "resumes a stopped sandbox with acting-user signing identity preserved",
    async ({ fixture }) => {
      const { authenticatedSession, sandboxInstanceId } = await prepareCodexSandbox({
        fixture,
        email: "sandbox-internal-mint-connection-token-restores-git-signing@example.com",
      });

      await stopSandboxInstance({
        fixture,
        sandboxInstanceId,
      });

      await waitForSandboxStatus({
        fixture,
        authenticatedSession,
        sandboxInstanceId,
        expectedStatus: "stopped",
      });
      await waitForSandboxConnectable({
        fixture,
        authenticatedSession,
        sandboxInstanceId,
        expectedConnectable: false,
      });

      const signingKey = await generateGitSshPrivateKey({
        email: "mistle-user@example.com",
      });

      try {
        await seedGitHubLinkedAccount({
          fixture,
          organizationId: authenticatedSession.organizationId,
          userId: authenticatedSession.userId,
        });
        await uploadGitHubSigningKey({
          fixture,
          cookie: authenticatedSession.cookie,
          privateKey: signingKey.privateKey,
        });

        const response = await fixture.request("/internal/sandbox-runtime/mint-connection-token", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [InternalAuthServiceTokenHeader]: fixture.internalAuthServiceToken,
          },
          body: JSON.stringify({
            organizationId: authenticatedSession.organizationId,
            instanceId: sandboxInstanceId,
            actingUserId: authenticatedSession.userId,
          }),
        });

        expect(response.status).toBe(200);
        const responseBody = InternalMintConnectionTokenResponseSchema.parse(await response.json());
        expect(responseBody.instanceId).toBe(sandboxInstanceId);

        await waitForSandboxStatus({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
          expectedStatus: "running",
        });
        await waitForSandboxConnectable({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
          expectedConnectable: true,
        });

        const commandResult = await runSandboxExecCommandInSandbox({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
          command: "sh",
          args: [
            "-lc",
            [
              "set -e",
              'printf "program=%s\\n" "$(git config --global --get gpg.ssh.program)"',
              'printf "signingkey=%s\\n" "$(git config --global --get user.signingkey)"',
              'workdir="$(mktemp -d)"',
              'cd "$workdir"',
              "git init -q",
              'printf "hello\\n" > README.md',
              "git add README.md",
              'git commit -q -S -m "signed commit after internal resume"',
              'commit_sha="$(git rev-parse HEAD)"',
              'printf "commit=%s\\n" "$commit_sha"',
              'git cat-file commit "$commit_sha"',
            ].join("; "),
          ],
          timeoutMs: 120_000,
        });

        expect(commandResult.exitCode).toBe(0);
        expect(commandResult.stdout).toContain("program=/opt/mistle/bin/mistle-ssh-sign");
        expect(commandResult.stdout).toContain("signingkey=key::ssh-ed25519 ");
        expect(commandResult.stdout).toContain("gpgsig ");
      } finally {
        await rm(signingKey.directory, { recursive: true, force: true });
      }
    },
    TestTimeoutMs,
  );
});

async function generateGitSshPrivateKey(input: { email: string }): Promise<{
  directory: string;
  privateKey: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "mistle-git-signing-key-"));
  const privateKeyPath = join(directory, "id_ed25519");

  await execFileAsync("ssh-keygen", [
    "-q",
    "-t",
    "ed25519",
    "-N",
    "",
    "-C",
    input.email,
    "-f",
    privateKeyPath,
  ]);

  return {
    directory,
    privateKey: await readFile(privateKeyPath, "utf8"),
  };
}

async function seedGitHubLinkedAccount(input: {
  fixture: Pick<SystemTestFixture, "db">;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const suffix = randomUUID().replaceAll("-", "");
  const targetKey = `github-signing-target-${suffix}`;
  const connectionId = `icn_github_signing_${suffix}`;
  const providerConfigId = `ilp_github_signing_${suffix}`;
  const principalId = `uep_github_signing_${suffix}`;
  const accessTokenCredentialId = `upc_github_access_${suffix}`;

  await input.fixture.db.insert(integrationTargets).values({
    targetKey,
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });

  await input.fixture.db.insert(integrationConnections).values({
    id: connectionId,
    organizationId: input.organizationId,
    targetKey,
    displayName: "GitHub Identity",
    status: IntegrationConnectionStatuses.ACTIVE,
    config: {
      connection_method: GitHubAppInstallationConnectionMethodId,
      app_id: "123",
      app_slug: "mistle-github-app",
      client_id: "Iv1.systemGitSigning",
    },
  });

  await input.fixture.db.insert(organizationIdentityLinkProviderConfigs).values({
    id: providerConfigId,
    organizationId: input.organizationId,
    providerFamily: "github",
    status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    integrationTargetKey: targetKey,
    integrationConnectionId: connectionId,
    createdByUserId: input.userId,
    updatedByUserId: input.userId,
    policy: {
      gitCommitSigningMode: "allowed",
    },
  });

  await input.fixture.db.insert(userExternalPrincipals).values({
    id: principalId,
    organizationId: input.organizationId,
    userId: input.userId,
    providerFamily: "github",
    providerSubjectId: suffix,
    organizationProviderConfigId: providerConfigId,
    integrationConnectionId: connectionId,
    status: UserExternalPrincipalStatuses.ACTIVE,
    profile: {
      login: "mistle-user",
      displayName: "Mistle User",
      preferredEmail: "mistle-user@example.com",
      availableEmails: [
        {
          email: "mistle-user@example.com",
          primary: true,
          verified: true,
        },
      ],
    },
  });

  await input.fixture.db.insert(userExternalPrincipalCredentials).values({
    id: accessTokenCredentialId,
    organizationId: input.organizationId,
    principalId,
    providerFamily: "github",
    credentialKind: "github_app_user_access_token",
    status: UserExternalPrincipalCredentialStatuses.ACTIVE,
  });
}

async function uploadGitHubSigningKey(input: {
  fixture: {
    request: (path: string, init?: RequestInit) => Promise<Response>;
  };
  cookie: string;
  privateKey: string;
}): Promise<void> {
  const formData = new FormData();
  formData.set(
    "file",
    new File([input.privateKey], "id_ed25519", {
      type: "application/octet-stream",
    }),
  );

  const response = await input.fixture.request("/v1/me/linked-accounts/github/signing-key", {
    method: "PUT",
    headers: {
      cookie: input.cookie,
    },
    body: formData,
  });

  expect(response.status).toBe(204);
}
