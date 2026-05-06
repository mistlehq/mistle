/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import http from "node:http";

import { createDockerSandboxReachableHostUrl, createSystemTest } from "@mistle/test-harness/system";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  prepareCodexSandbox,
  runSandboxExecCommandInSandbox,
  stopSandboxInstance,
} from "../system/helpers/codex-sandbox.js";
import { createRuntimeCodexSandboxFixture } from "./helpers/runtime-codex-sandbox.js";

const it = createSystemTest({
  extraInfra: ["mailpit"],
  sandbox: {
    provider: "docker",
  },
  gatewayProxy: true,
});

const SYSTEM_TEST_TIMEOUT_MS = 5 * 60_000;
const SANDBOXD_EGRESS_PROXY_URL = "http://127.0.0.1:38513";
const HTTP_REQUEST_BODY = "phase4a-gateway-egress-http-smoke";
const HTTPS_SMOKE_URL = "https://example.com/";
const SMOKE_MARKER = "MISTLE_GATEWAY_EGRESS_HTTP_AND_HTTPS_OK";

const HttpEchoResponseSchema = z
  .object({
    ok: z.literal(true),
    method: z.string(),
    url: z.string(),
    body: z.string(),
  })
  .strict();

type RecordedHttpRequest = {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
};

describe("runtime system gateway egress HTTP smoke", () => {
  it(
    "forwards sandbox HTTP and HTTPS proxy traffic through the gateway tunnel",
    async ({ system }) => {
      const upstream = await startSimulatedHttpUpstream();
      const fixture = createRuntimeCodexSandboxFixture(system);
      let sandboxInstanceIdForCleanup: string | undefined;

      try {
        const { authenticatedSession, sandboxInstanceId } = await prepareCodexSandbox({
          fixture,
          email: "runtime-gateway-egress-http-smoke@example.com",
        });
        sandboxInstanceIdForCleanup = sandboxInstanceId;

        const result = await runSandboxExecCommandInSandbox({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
          command: "sh",
          args: [
            "-lc",
            [
              'test "${GATEWAY_PROXY_ENABLED:-}" = "1"',
              [
                "curl",
                "--proxy",
                shellQuote(SANDBOXD_EGRESS_PROXY_URL),
                "--noproxy ''",
                "-fsS",
                "-X POST",
                "-H 'content-type: text/plain'",
                `--data ${shellQuote(HTTP_REQUEST_BODY)}`,
                shellQuote(`${upstream.sandboxReachableBaseUrl}/echo?case=http`),
              ].join(" "),
              "printf '\\n'",
              [
                "curl",
                "--proxy",
                shellQuote(SANDBOXD_EGRESS_PROXY_URL),
                "--noproxy ''",
                "-k",
                "-fsS",
                shellQuote(HTTPS_SMOKE_URL),
                "| grep -q 'Example Domain'",
              ].join(" "),
              `printf '%s\\n' ${shellQuote(SMOKE_MARKER)}`,
            ].join("\n"),
          ],
          timeoutMs: 90_000,
        });

        if (result.exitCode !== 0) {
          throw new Error(
            `Gateway egress smoke command failed with exit code ${String(result.exitCode)}. stdout=${result.stdout} stderr=${result.stderr}`,
          );
        }

        const response = parseHttpEchoResponse(result.stdout);
        expect(response).toEqual({
          ok: true,
          method: "POST",
          url: "/echo?case=http",
          body: HTTP_REQUEST_BODY,
        });
        expect(result.stdout).toContain(SMOKE_MARKER);
        expect(upstream.requests).toHaveLength(1);
        expect(upstream.requests[0]).toMatchObject({
          method: "POST",
          url: "/echo?case=http",
          body: HTTP_REQUEST_BODY,
        });
        expect(upstream.requests[0]?.headers["x-mistle-egress-grant"]).toBeUndefined();
      } finally {
        if (sandboxInstanceIdForCleanup !== undefined) {
          await stopSandboxInstance({
            fixture,
            sandboxInstanceId: sandboxInstanceIdForCleanup,
          });
        }
        await upstream.stop();
      }
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});

async function startSimulatedHttpUpstream(): Promise<{
  sandboxReachableBaseUrl: string;
  requests: RecordedHttpRequest[];
  stop: () => Promise<void>;
}> {
  const requests: RecordedHttpRequest[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const recordedRequest = {
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body,
      };
      requests.push(recordedRequest);

      const responseBody = JSON.stringify({
        ok: true,
        method: recordedRequest.method,
        url: recordedRequest.url,
        body,
      });
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(responseBody).toString(),
      });
      response.end(responseBody);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Simulated HTTP upstream did not expose a TCP listener address.");
  }

  return {
    sandboxReachableBaseUrl: createDockerSandboxReachableHostUrl(
      `http://127.0.0.1:${String(address.port)}`,
    ),
    requests,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

function parseHttpEchoResponse(stdout: string): z.infer<typeof HttpEchoResponseSchema> {
  const responseLine = stdout
    .trim()
    .split("\n")
    .find((line) => line.startsWith("{"));
  if (responseLine === undefined) {
    throw new Error(
      `Gateway egress smoke command did not return an HTTP response. stdout=${stdout}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseLine);
  } catch (error) {
    throw new Error(
      `Gateway egress smoke command returned invalid HTTP JSON: ${error instanceof Error ? error.message : String(error)}. stdout=${stdout}`,
    );
  }

  return HttpEchoResponseSchema.parse(parsed);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
