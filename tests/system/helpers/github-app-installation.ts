import { createSign } from "node:crypto";

import { z } from "zod";
const GitHubAppInstallationResponseSchema = z.looseObject({
  id: z.union([z.string().min(1), z.number().int().positive()]),
  app_id: z.union([z.string().min(1), z.number().int().positive()]),
  app_slug: z.string().min(1),
});
const GitHubAppWebhookConfigResponseSchema = z.looseObject({
  url: z.string().min(1),
  content_type: z.string().min(1).optional(),
  insecure_ssl: z.union([z.string().min(1), z.number().int().nonnegative()]).optional(),
});

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
  const appId = process.env.MISTLE_TEST_GITHUB_APP_ID;
  if (typeof appId !== "string" || appId.length === 0) {
    throw new Error(
      `GitHub system tests for target '${targetKey}' require env MISTLE_TEST_GITHUB_APP_ID.`,
    );
  }

  const appSlug = process.env.MISTLE_TEST_GITHUB_APP_SLUG;
  if (typeof appSlug !== "string" || appSlug.length === 0) {
    throw new Error(
      `GitHub system tests for target '${targetKey}' require env MISTLE_TEST_GITHUB_APP_SLUG.`,
    );
  }

  const appPrivateKeyPem = process.env.MISTLE_TEST_GITHUB_APP_PRIVATE_KEY_PEM;
  if (typeof appPrivateKeyPem !== "string" || appPrivateKeyPem.length === 0) {
    throw new Error(
      `GitHub system tests for target '${targetKey}' require env MISTLE_TEST_GITHUB_APP_PRIVATE_KEY_PEM.`,
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

function createGitHubAppAuthorizationHeader(): string {
  const provisionedTarget = {
    appId: process.env.MISTLE_TEST_GITHUB_APP_ID,
    appPrivateKeyPem: process.env.MISTLE_TEST_GITHUB_APP_PRIVATE_KEY_PEM,
  };

  if (
    typeof provisionedTarget.appId !== "string" ||
    provisionedTarget.appId.length === 0 ||
    typeof provisionedTarget.appPrivateKeyPem !== "string" ||
    provisionedTarget.appPrivateKeyPem.length === 0
  ) {
    throw new Error(
      "GitHub system tests require env MISTLE_TEST_GITHUB_APP_ID and MISTLE_TEST_GITHUB_APP_PRIVATE_KEY_PEM.",
    );
  }

  return `Bearer ${createGitHubAppJwt({
    appId: provisionedTarget.appId,
    appPrivateKeyPem: normalizeEscapedNewlines(provisionedTarget.appPrivateKeyPem),
  })}`;
}

export async function readGitHubAppWebhookConfig(): Promise<{
  url: string;
  contentType?: string;
  insecureSsl?: string;
}> {
  const response = await fetch("https://api.github.com/app/hook/config", {
    headers: {
      authorization: createGitHubAppAuthorizationHeader(),
      accept: "application/vnd.github+json",
      "user-agent": "mistle-system-tests",
      "x-github-api-version": "2022-11-28",
    },
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Failed to read GitHub App webhook config: status ${String(response.status)} body ${responseText}`,
    );
  }

  const parsed = GitHubAppWebhookConfigResponseSchema.parse(JSON.parse(responseText));
  return {
    url: parsed.url,
    ...(parsed.content_type === undefined ? {} : { contentType: parsed.content_type }),
    ...(parsed.insecure_ssl === undefined ? {} : { insecureSsl: parsed.insecure_ssl.toString() }),
  };
}

export async function updateGitHubAppWebhookConfig(input: {
  url: string;
  contentType?: string;
  insecureSsl?: string;
}): Promise<void> {
  const response = await fetch("https://api.github.com/app/hook/config", {
    method: "PATCH",
    headers: {
      authorization: createGitHubAppAuthorizationHeader(),
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "mistle-system-tests",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({
      url: input.url,
      ...(input.contentType === undefined ? {} : { content_type: input.contentType }),
      ...(input.insecureSsl === undefined ? {} : { insecure_ssl: input.insecureSsl }),
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Failed to update GitHub App webhook config: status ${String(response.status)} body ${responseText}`,
    );
  }
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
