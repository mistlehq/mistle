import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { startDockerTargetApp, startWorkspaceApp } from "../src/index.js";

const PROJECT_ROOT_HOST_PATH = fileURLToPath(new URL("../../..", import.meta.url));
const TEST_TIMEOUT_MS = 120_000;

describe("workspace app launcher integration", () => {
  test(
    "starts a workspace-mounted app container and serves HTTP readiness",
    async () => {
      const containerPort = 38080;
      const service = await startWorkspaceApp({
        baseImage: "node:22-alpine",
        projectRootHostPath: PROJECT_ROOT_HOST_PATH,
        workspaceDirInContainer: "/app",
        command: [
          "sh",
          "-euc",
          [
            "test -f /app/pnpm-workspace.yaml",
            "node -e \"const http = require('node:http'); const port = Number(process.env.TEST_APP_PORT); http.createServer((_, res) => { res.writeHead(200); res.end('ok'); }).listen(port, '0.0.0.0', () => console.log('workspace-http-ready')); setInterval(() => {}, 1_000);\"",
          ].join("\n"),
        ],
        environment: {
          TEST_APP_PORT: String(containerPort),
        },
        containerPort,
        networkAlias: "workspace-http-app",
        startupTimeoutMs: 45_000,
        readiness: {
          kind: "http",
          path: "/",
          expectedStatus: 200,
        },
      });

      try {
        const response = await fetch(`${service.hostBaseUrl}/`);
        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe("ok");
        expect(service.containerBaseUrl).toBe("http://workspace-http-app:38080");
        expect(service.containerId).toMatch(/^[0-9a-f]{12,}$/);
      } finally {
        await service.stop();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "supports log readiness and rejects double stop",
    async () => {
      const service = await startWorkspaceApp({
        baseImage: "alpine:3.22",
        projectRootHostPath: PROJECT_ROOT_HOST_PATH,
        workspaceDirInContainer: "/app",
        command: [
          "sh",
          "-euc",
          ["test -f /app/pnpm-workspace.yaml", "echo workspace-log-ready", "sleep 120"].join("\n"),
        ],
        environment: {},
        containerPort: 38081,
        networkAlias: "workspace-log-app",
        startupTimeoutMs: 20_000,
        readiness: {
          kind: "log",
          pattern: /workspace-log-ready/,
          times: 1,
        },
      });

      await service.stop();
      await expect(service.stop()).rejects.toThrow("Workspace app container was already stopped.");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "supports command readiness",
    async () => {
      const service = await startWorkspaceApp({
        baseImage: "alpine:3.22",
        projectRootHostPath: PROJECT_ROOT_HOST_PATH,
        workspaceDirInContainer: "/app",
        command: ["sh", "-euc", "sleep 120"],
        environment: {},
        containerPort: 38084,
        networkAlias: "workspace-command-app",
        startupTimeoutMs: 20_000,
        readiness: {
          kind: "command",
          command: "test -f /app/pnpm-workspace.yaml",
        },
      });

      await service.stop();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "builds and starts app from Dockerfile target",
    async () => {
      const dockerContextPath = await mkdtemp(join(tmpdir(), "mistle-test-harness-docker-target-"));

      try {
        await writeFile(
          join(dockerContextPath, "Dockerfile"),
          [
            "FROM alpine:3.22 AS runtime",
            'CMD ["sh", "-euc", "echo docker-target-ready && sleep 120"]',
          ].join("\n"),
          "utf8",
        );

        const service = await startDockerTargetApp({
          buildContextHostPath: dockerContextPath,
          dockerfileRelativePath: "Dockerfile",
          dockerTarget: "runtime",
          environment: {},
          containerPort: 38082,
          networkAlias: "docker-target-app",
          startupTimeoutMs: 30_000,
          readiness: {
            kind: "log",
            pattern: /docker-target-ready/,
            times: 1,
          },
        });

        try {
          expect(service.containerBaseUrl).toBe("http://docker-target-app:38082");
          expect(service.containerId).toMatch(/^[0-9a-f]{12,}$/);
        } finally {
          await service.stop();
        }
      } finally {
        await rm(dockerContextPath, {
          recursive: true,
          force: true,
        });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "cacheBustKey forces docker target image rebuild",
    async () => {
      const dockerContextPath = await mkdtemp(join(tmpdir(), "mistle-test-harness-cache-bust-"));
      const dockerfilePath = join(dockerContextPath, "Dockerfile");

      try {
        await writeFile(
          dockerfilePath,
          [
            "FROM alpine:3.22 AS runtime",
            'CMD ["sh", "-euc", "echo cache-bust-a && sleep 120"]',
          ].join("\n"),
          "utf8",
        );

        const firstService = await startDockerTargetApp({
          buildContextHostPath: dockerContextPath,
          dockerfileRelativePath: "Dockerfile",
          dockerTarget: "runtime",
          environment: {},
          containerPort: 38085,
          networkAlias: "docker-target-cache-bust-a",
          startupTimeoutMs: 30_000,
          readiness: {
            kind: "log",
            pattern: /cache-bust-a/,
            times: 1,
          },
        });
        await firstService.stop();

        await writeFile(
          dockerfilePath,
          [
            "FROM alpine:3.22 AS runtime",
            'CMD ["sh", "-euc", "echo cache-bust-b && sleep 120"]',
          ].join("\n"),
          "utf8",
        );

        const secondService = await startDockerTargetApp({
          buildContextHostPath: dockerContextPath,
          dockerfileRelativePath: "Dockerfile",
          dockerTarget: "runtime",
          cacheBustKey: "v2",
          environment: {},
          containerPort: 38086,
          networkAlias: "docker-target-cache-bust-b",
          startupTimeoutMs: 30_000,
          readiness: {
            kind: "log",
            pattern: /cache-bust-b/,
            times: 1,
          },
        });

        await secondService.stop();
      } finally {
        await rm(dockerContextPath, {
          recursive: true,
          force: true,
        });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test("fails fast for non-absolute project root host path", async () => {
    await expect(
      startWorkspaceApp({
        baseImage: "alpine:3.22",
        projectRootHostPath: "relative/path",
        workspaceDirInContainer: "/app",
        command: ["sh", "-euc", "echo noop"],
        environment: {},
        containerPort: 38083,
        networkAlias: "workspace-validate-app",
        startupTimeoutMs: 10_000,
        readiness: {
          kind: "log",
          pattern: /noop/,
          times: 1,
        },
      }),
    ).rejects.toThrow("projectRootHostPath must be an absolute path.");
  });
});
