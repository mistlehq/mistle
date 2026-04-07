import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const IntegrationTargetsProvisionManifestPath = fileURLToPath(
  new URL("../../../integration-targets.provision.json", import.meta.url),
);
const GitHubAppInstallationResponseSchema = z.looseObject({
  id: z.union([z.string().min(1), z.number().int().positive()]),
  app_id: z.union([z.string().min(1), z.number().int().positive()]),
  app_slug: z.string().min(1),
});

const IntegrationTargetProvisionManifestSchema = z
  .object({
    version: z.number().int().positive(),
    targets: z.array(
      z.object({
        targetKey: z.string().min(1),
        config: z.record(z.string(), z.unknown()),
        secrets: z.record(z.string(), z.string()).optional(),
      }),
    ),
  })
  .strict();

type ProvisionedGitHubTarget = {
  appId: string;
  appSlug: string;
  appPrivateKeyPem: string;
};

function normalizeEscapedNewlines(value: string): string {
  return value
    .replaceAll("\\\\r\\\\n", "\r\n")
    .replaceAll("\\\\n", "\n")
    .replaceAll("\\r\\n", "\r\n")
    .replaceAll("\\n", "\n");
}

async function readProvisionedGitHubTarget(targetKey: string): Promise<ProvisionedGitHubTarget> {
  const rawManifest = await readFile(IntegrationTargetsProvisionManifestPath, "utf8");
  const manifest = IntegrationTargetProvisionManifestSchema.parse(JSON.parse(rawManifest));
  const target = manifest.targets.find((candidate) => candidate.targetKey === targetKey);
  if (target === undefined) {
    throw new Error(`Integration target provision manifest is missing target '${targetKey}'.`);
  }

  const appId = target.config["app_id"];
  if (typeof appId !== "string" || appId.length === 0) {
    throw new Error(`Provisioned GitHub target '${targetKey}' is missing config 'app_id'.`);
  }

  const appSlug = target.config["app_slug"];
  if (typeof appSlug !== "string" || appSlug.length === 0) {
    throw new Error(`Provisioned GitHub target '${targetKey}' is missing config 'app_slug'.`);
  }

  const appPrivateKeyPem = target.secrets?.["app_private_key_pem"];
  if (typeof appPrivateKeyPem !== "string" || appPrivateKeyPem.length === 0) {
    throw new Error(
      `Provisioned GitHub target '${targetKey}' is missing secret 'app_private_key_pem'.`,
    );
  }

  return {
    appId,
    appSlug,
    appPrivateKeyPem: normalizeEscapedNewlines(appPrivateKeyPem),
  };
}

function createGitHubAppJwt(input: { appId: string; appPrivateKeyPem: string }): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 600,
      iss: input.appId,
    }),
  ).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer.sign(input.appPrivateKeyPem).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

export async function resolveGitHubAppInstallationId(input: {
  owner: string;
  repo: string;
  targetKey: string;
}): Promise<string> {
  const provisionedTarget = await readProvisionedGitHubTarget(input.targetKey);
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/installation`,
    {
      headers: {
        authorization: `Bearer ${createGitHubAppJwt({
          appId: provisionedTarget.appId,
          appPrivateKeyPem: provisionedTarget.appPrivateKeyPem,
        })}`,
        accept: "application/vnd.github+json",
        "user-agent": "mistle-system-tests",
        "x-github-api-version": "2022-11-28",
      },
    },
  );

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Failed to resolve GitHub App installation for ${input.owner}/${input.repo}: status ${String(response.status)} body ${responseText}`,
    );
  }

  const installation = GitHubAppInstallationResponseSchema.parse(JSON.parse(responseText));
  if (installation.app_slug !== provisionedTarget.appSlug) {
    throw new Error(
      `Resolved GitHub App installation for ${input.owner}/${input.repo} belongs to '${installation.app_slug}', expected '${provisionedTarget.appSlug}'.`,
    );
  }

  if (installation.app_id.toString() !== provisionedTarget.appId) {
    throw new Error(
      `Resolved GitHub App installation for ${input.owner}/${input.repo} belongs to app '${installation.app_id.toString()}', expected '${provisionedTarget.appId}'.`,
    );
  }

  return installation.id.toString();
}
