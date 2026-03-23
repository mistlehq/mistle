import { once } from "node:events";
import {
  createServer as createHttpServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type RequestListener,
  type Server as HttpServer,
} from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { checkServerIdentity, connect as connectTls, type TLSSocket } from "node:tls";
import { gzipSync } from "node:zlib";

import { type CompiledRuntimePlan } from "@mistle/integrations-core";
import { generateProxyCa, issueProxyLeafCertificate } from "@mistle/sandbox-rs-napi";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeHttpServer } from "../src/runtime/http-server.js";
import {
  createCertificateAuthority,
  type CertificateAuthority,
} from "../src/runtime/proxy/certificate-authority.js";
import { createProxyServer } from "../src/runtime/proxy/proxy-server.js";

type StartedServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

const StartedServers: StartedServer[] = [];

async function startHttpServer(handler: RequestListener): Promise<StartedServer> {
  const server = createHttpServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected listening TCP address");
  }

  const startedServer: StartedServer = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
  StartedServers.push(startedServer);
  return startedServer;
}

async function startHttpsServer(input: {
  caCertificatePem: string;
  caPrivateKeyPem: string;
  handler: RequestListener;
  onUpgrade?: (
    request: import("node:http").IncomingMessage,
    socket: TLSSocket,
    head: Buffer,
  ) => void;
}): Promise<StartedServer> {
  const issuedLeafCertificate = issueProxyLeafCertificate({
    caCertificatePem: input.caCertificatePem,
    caPrivateKeyPem: input.caPrivateKeyPem,
    serverName: "127.0.0.1",
  });
  const server: HttpsServer = createHttpsServer(
    {
      cert: issuedLeafCertificate.certificateChainPem,
      key: issuedLeafCertificate.privateKeyPem,
    },
    input.handler,
  );
  if (input.onUpgrade !== undefined) {
    server.on("upgrade", input.onUpgrade);
  }

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected listening TCP address");
  }

  const startedServer: StartedServer = {
    baseUrl: `https://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
  StartedServers.push(startedServer);
  return startedServer;
}

async function startProxyServer(input: {
  runtimePlan: CompiledRuntimePlan;
  tokenizerProxyEgressBaseUrl: string;
  certificateAuthority?: CertificateAuthority;
  trustedCaCertificatesPem?: string[];
}): Promise<StartedServer> {
  const proxyServer = createProxyServer(input);
  const server: HttpServer = createRuntimeHttpServer({
    state: {
      startupReady: true,
    },
    proxyServer,
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected listening TCP address");
  }

  const startedServer: StartedServer = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
      await proxyServer.close();
    },
  };
  StartedServers.push(startedServer);
  return startedServer;
}

function buildProxyMediationRuntimePlan(): CompiledRuntimePlan {
  return {
    sandboxProfileId: "sbp_proxy_test",
    version: 1,
    image: {
      source: "base",
      imageRef: "mistle/sandbox-base:dev",
    },
    egressRoutes: [
      {
        egressRuleId: "egress_rule_openai",
        bindingId: "ibd_openai",
        match: {
          hosts: ["api.openai.com"],
          pathPrefixes: ["/v1"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://api.openai.com/v1",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: "icn_openai",
          secretType: "api_key",
          purpose: "api_key",
          resolverKey: "default",
        },
      },
    ],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  };
}

async function performPlainHttpProxyRequest(input: {
  proxyBaseUrl: string;
  targetUrl: string;
  method: string;
  headers?: IncomingHttpHeaders;
  body?: string;
}): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }> {
  const proxyUrl = new URL(input.proxyBaseUrl);
  const targetUrl = new URL(input.targetUrl);

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: proxyUrl.hostname,
        port: proxyUrl.port,
        method: input.method,
        path: targetUrl.toString(),
        headers: {
          Host: targetUrl.host,
          Connection: "close",
          ...input.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.once("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    request.once("error", reject);
    if (input.body !== undefined) {
      request.write(input.body);
    }
    request.end();
  });
}

async function establishHttpsTunnel(input: {
  proxyBaseUrl: string;
  targetUrl: string;
  caCertificatePem: string;
}): Promise<TLSSocket> {
  const proxyUrl = new URL(input.proxyBaseUrl);
  const targetUrl = new URL(input.targetUrl);
  const connectTarget = `${targetUrl.hostname}:${targetUrl.port || "443"}`;

  return new Promise((resolve, reject) => {
    const connectRequest = httpRequest({
      host: proxyUrl.hostname,
      port: proxyUrl.port,
      method: "CONNECT",
      path: connectTarget,
      headers: {
        Host: connectTarget,
      },
    });

    connectRequest.once("connect", (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`expected connect status 200, got ${response.statusCode ?? 0}`));
        return;
      }

      const tlsSocket = connectTls({
        socket,
        ca: input.caCertificatePem,
        checkServerIdentity(servername, certificate) {
          return checkServerIdentity(targetUrl.hostname, certificate);
        },
        ...(targetUrl.hostname === "127.0.0.1" ? {} : { servername: targetUrl.hostname }),
      });

      tlsSocket.once("secureConnect", () => {
        if (head.length > 0) {
          tlsSocket.unshift(head);
        }
        resolve(tlsSocket);
      });
      tlsSocket.once("error", reject);
    });

    connectRequest.once("error", reject);
    connectRequest.end();
  });
}

function parseHttpResponse(rawResponse: string): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  const headerSeparatorIndex = rawResponse.indexOf("\r\n\r\n");
  if (headerSeparatorIndex < 0) {
    throw new Error("response headers are incomplete");
  }

  const rawHeaders = rawResponse.slice(0, headerSeparatorIndex);
  const body = rawResponse.slice(headerSeparatorIndex + 4);
  const headerLines = rawHeaders.split("\r\n");
  const statusLine = headerLines[0];
  if (statusLine === undefined) {
    throw new Error("status line is required");
  }

  const rawStatusCode = statusLine.split(" ")[1];
  if (rawStatusCode === undefined) {
    throw new Error("status code is required");
  }

  const statusCode = Number.parseInt(rawStatusCode, 10);
  const headers: Record<string, string> = {};
  for (const headerLine of headerLines.slice(1)) {
    const separatorIndex = headerLine.indexOf(":");
    if (separatorIndex < 0) {
      continue;
    }

    headers[headerLine.slice(0, separatorIndex).toLowerCase()] = headerLine
      .slice(separatorIndex + 1)
      .trim();
  }

  return {
    statusCode,
    headers,
    body: headers["transfer-encoding"] === "chunked" ? decodeChunkedBody(body) : body,
  };
}

function decodeChunkedBody(rawBody: string): string {
  let remaining = rawBody;
  let decodedBody = "";

  while (remaining.length > 0) {
    const sizeLineSeparatorIndex = remaining.indexOf("\r\n");
    if (sizeLineSeparatorIndex < 0) {
      break;
    }

    const rawChunkSize = remaining.slice(0, sizeLineSeparatorIndex);
    const chunkSize = Number.parseInt(rawChunkSize, 16);
    if (!Number.isFinite(chunkSize) || chunkSize < 0) {
      throw new Error(`invalid chunk size ${rawChunkSize}`);
    }

    remaining = remaining.slice(sizeLineSeparatorIndex + 2);
    if (chunkSize === 0) {
      break;
    }

    decodedBody += remaining.slice(0, chunkSize);
    remaining = remaining.slice(chunkSize + 2);
  }

  return decodedBody;
}

async function performHttpsProxyRequest(input: {
  proxyBaseUrl: string;
  targetUrl: string;
  caCertificatePem: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  const targetUrl = new URL(input.targetUrl);
  const tlsSocket = await establishHttpsTunnel(input);
  const body = input.body ?? "";

  tlsSocket.write(
    [
      `${input.method} ${targetUrl.pathname}${targetUrl.search} HTTP/1.1`,
      `Host: ${targetUrl.host}`,
      "Connection: close",
      ...(input.headers === undefined
        ? []
        : Object.entries(input.headers).map(
            ([headerName, headerValue]) => `${headerName}: ${headerValue}`,
          )),
      body.length > 0 ? `Content-Length: ${Buffer.byteLength(body, "utf8")}` : "",
      "",
      body,
    ].join("\r\n"),
  );

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    tlsSocket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    tlsSocket.once("end", () => {
      resolve(parseHttpResponse(Buffer.concat(chunks).toString("utf8")));
    });
    tlsSocket.once("error", reject);
  });
}

async function performHttpsUpgradeProxyRequest(input: {
  proxyBaseUrl: string;
  targetUrl: string;
  caCertificatePem: string;
}): Promise<string> {
  const targetUrl = new URL(input.targetUrl);
  const tlsSocket = await establishHttpsTunnel(input);

  tlsSocket.write(
    [
      `GET ${targetUrl.pathname}${targetUrl.search} HTTP/1.1`,
      `Host: ${targetUrl.host}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "",
      "",
    ].join("\r\n"),
  );

  await new Promise<void>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const onData = (chunk: Buffer): void => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).toString("utf8").includes("\r\n\r\n")) {
        tlsSocket.off("data", onData);
        resolve();
      }
    };

    tlsSocket.on("data", onData);
    tlsSocket.once("error", reject);
  });

  tlsSocket.write("ping\n");

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const onData = (chunk: Buffer): void => {
      chunks.push(chunk);
      const merged = Buffer.concat(chunks).toString("utf8");
      if (merged.endsWith("pong\n")) {
        tlsSocket.off("data", onData);
        tlsSocket.end();
        resolve("pong\n");
      }
    };

    tlsSocket.on("data", onData);
    tlsSocket.once("error", reject);
  });
}

afterEach(async () => {
  for (const startedServer of StartedServers.splice(0).reverse()) {
    await startedServer.close();
  }
});

describe("proxy mediation", () => {
  it("mediates matching plain http traffic through tokenizer proxy", async () => {
    let capturedPath = "";
    let capturedQuery = "";
    let capturedBindingId = "";
    const tokenizerProxyServer = await startHttpServer((request, response) => {
      const tokenizerProxyUrl = new URL(`http://tokenizer-proxy.internal${request.url ?? "/"}`);
      capturedPath = tokenizerProxyUrl.pathname;
      capturedQuery = tokenizerProxyUrl.search.startsWith("?")
        ? tokenizerProxyUrl.search.slice(1)
        : tokenizerProxyUrl.search;
      const bindingIdHeader = request.headers["x-mistle-egress-binding-id"];
      capturedBindingId =
        typeof bindingIdHeader === "string" ? bindingIdHeader : (bindingIdHeader?.[0] ?? "");
      response.writeHead(201, { "content-type": "application/json" });
      response.end(`{"tokenized":true}`);
    });

    const proxyServer = await startProxyServer({
      runtimePlan: buildProxyMediationRuntimePlan(),
      tokenizerProxyEgressBaseUrl: `${tokenizerProxyServer.baseUrl}/tokenizer-proxy/egress`,
    });

    const response = await performPlainHttpProxyRequest({
      proxyBaseUrl: proxyServer.baseUrl,
      targetUrl: "http://api.openai.com/v1/responses?stream=true",
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: `{"model":"gpt-5"}`,
    });

    expect(response.statusCode).toBe(201);
    expect(response.body).toBe(`{"tokenized":true}`);
    expect(capturedPath).toBe("/tokenizer-proxy/egress/v1/responses");
    expect(capturedQuery).toBe("stream=true");
    expect(capturedBindingId).toBe("ibd_openai");
  });

  it("mediates matching intercepted https traffic through tokenizer proxy", async () => {
    let capturedPath = "";
    let capturedUpstreamBaseUrl = "";
    const tokenizerProxyServer = await startHttpServer((request, response) => {
      const tokenizerProxyUrl = new URL(`http://tokenizer-proxy.internal${request.url ?? "/"}`);
      capturedPath = tokenizerProxyUrl.pathname;
      const upstreamBaseUrlHeader = request.headers["x-mistle-egress-upstream-base-url"];
      capturedUpstreamBaseUrl =
        typeof upstreamBaseUrlHeader === "string"
          ? upstreamBaseUrlHeader
          : (upstreamBaseUrlHeader?.[0] ?? "");
      response.writeHead(202, { "content-type": "application/json" });
      response.end(`{"intercepted":true}`);
    });

    const proxyCa = generateProxyCa();
    const proxyServer = await startProxyServer({
      runtimePlan: buildProxyMediationRuntimePlan(),
      tokenizerProxyEgressBaseUrl: `${tokenizerProxyServer.baseUrl}/tokenizer-proxy/egress`,
      certificateAuthority: createCertificateAuthority(
        proxyCa.certificatePem,
        proxyCa.privateKeyPem,
      ),
    });

    const response = await performHttpsProxyRequest({
      proxyBaseUrl: proxyServer.baseUrl,
      targetUrl: "https://api.openai.com/v1/responses?stream=true",
      caCertificatePem: proxyCa.certificatePem,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: `{"model":"gpt-5"}`,
    });

    expect(response.statusCode).toBe(202);
    expect(response.body).toBe(`{"intercepted":true}`);
    expect(capturedPath).toBe("/tokenizer-proxy/egress/v1/responses");
    expect(capturedUpstreamBaseUrl).toBe("https://api.openai.com/v1");
  });

  it("mediates matching intercepted https upgrades through tokenizer proxy", async () => {
    let capturedPath = "";
    let capturedUpstreamBaseUrl = "";

    const upgradeCapableServer = createHttpServer((_request, response) => {
      response.writeHead(426);
      response.end();
    });
    upgradeCapableServer.on("upgrade", (request, socket) => {
      const tokenizerProxyUrl = new URL(`http://tokenizer-proxy.internal${request.url ?? "/"}`);
      capturedPath = tokenizerProxyUrl.pathname;
      const upstreamBaseUrlHeader = request.headers["x-mistle-egress-upstream-base-url"];
      capturedUpstreamBaseUrl =
        typeof upstreamBaseUrlHeader === "string"
          ? upstreamBaseUrlHeader
          : (upstreamBaseUrlHeader?.[0] ?? "");

      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
      );
      socket.once("data", (payloadChunk: Buffer) => {
        expect(payloadChunk.toString("utf8")).toBe("ping\n");
        socket.write("pong\n");
        socket.end();
      });
    });
    upgradeCapableServer.listen(0, "127.0.0.1");
    await once(upgradeCapableServer, "listening");

    const address = upgradeCapableServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected listening TCP address");
    }

    StartedServers.push({
      baseUrl: `http://127.0.0.1:${address.port}`,
      close: async () => {
        upgradeCapableServer.close();
        await once(upgradeCapableServer, "close");
      },
    });

    const proxyCa = generateProxyCa();
    const proxyServer = await startProxyServer({
      runtimePlan: buildProxyMediationRuntimePlan(),
      tokenizerProxyEgressBaseUrl: `http://127.0.0.1:${address.port}/tokenizer-proxy/egress`,
      certificateAuthority: createCertificateAuthority(
        proxyCa.certificatePem,
        proxyCa.privateKeyPem,
      ),
    });

    await expect(
      performHttpsUpgradeProxyRequest({
        proxyBaseUrl: proxyServer.baseUrl,
        targetUrl: "https://api.openai.com/v1/responses?stream=true",
        caCertificatePem: proxyCa.certificatePem,
      }),
    ).resolves.toBe("pong\n");

    expect(capturedPath).toBe("/tokenizer-proxy/egress/v1/responses");
    expect(capturedUpstreamBaseUrl).toBe("https://api.openai.com/v1");
  });

  it("re-originates unmatched plain http traffic without mediation", async () => {
    let tokenizerProxyRequests = 0;
    const tokenizerProxyServer = await startHttpServer((_request, response) => {
      tokenizerProxyRequests += 1;
      response.writeHead(500);
      response.end();
    });
    const upstreamServer = await startHttpServer((request, response) => {
      expect(request.url).toBe("/healthz");
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("upstream-ok");
    });
    const proxyServer = await startProxyServer({
      runtimePlan: buildProxyMediationRuntimePlan(),
      tokenizerProxyEgressBaseUrl: `${tokenizerProxyServer.baseUrl}/tokenizer-proxy/egress`,
    });

    const response = await performPlainHttpProxyRequest({
      proxyBaseUrl: proxyServer.baseUrl,
      targetUrl: `${upstreamServer.baseUrl}/healthz`,
      method: "GET",
    });

    expect(tokenizerProxyRequests).toBe(0);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("upstream-ok");
  });

  it("re-originates unmatched compressed https traffic without stale encoding headers", async () => {
    let tokenizerProxyRequests = 0;
    const tokenizerProxyServer = await startHttpServer((_request, response) => {
      tokenizerProxyRequests += 1;
      response.writeHead(500);
      response.end();
    });
    const upstreamCa = generateProxyCa();
    const upstreamServer = await startHttpsServer({
      caCertificatePem: upstreamCa.certificatePem,
      caPrivateKeyPem: upstreamCa.privateKeyPem,
      handler: (request, response) => {
        expect(request.url).toBe("/packages/mistle");
        response.writeHead(200, {
          "content-type": "application/json",
          "content-encoding": "gzip",
        });
        response.end(gzipSync(`{"name":"mistle"}`));
      },
    });

    const proxyCa = generateProxyCa();
    const proxyServer = await startProxyServer({
      runtimePlan: buildProxyMediationRuntimePlan(),
      tokenizerProxyEgressBaseUrl: `${tokenizerProxyServer.baseUrl}/tokenizer-proxy/egress`,
      certificateAuthority: createCertificateAuthority(
        proxyCa.certificatePem,
        proxyCa.privateKeyPem,
      ),
      trustedCaCertificatesPem: [upstreamCa.certificatePem],
    });

    const response = await performHttpsProxyRequest({
      proxyBaseUrl: proxyServer.baseUrl,
      targetUrl: `${upstreamServer.baseUrl}/packages/mistle`,
      caCertificatePem: proxyCa.certificatePem,
      method: "GET",
    });

    expect(tokenizerProxyRequests).toBe(0);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.body).toBe(`{"name":"mistle"}`);
  });

  it("fails closed when multiple routes match the same request", async () => {
    const runtimePlan = buildProxyMediationRuntimePlan();
    runtimePlan.egressRoutes = [
      ...runtimePlan.egressRoutes,
      {
        ...runtimePlan.egressRoutes[0]!,
        egressRuleId: "egress_rule_openai_duplicate",
        bindingId: "ibd_openai_duplicate",
        credentialResolver: {
          connectionId: "icn_openai_duplicate",
          secretType: "api_key",
          purpose: "api_key",
          resolverKey: "default",
        },
      },
    ];

    const proxyServer = await startProxyServer({
      runtimePlan,
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:1/tokenizer-proxy/egress",
    });

    const response = await performPlainHttpProxyRequest({
      proxyBaseUrl: proxyServer.baseUrl,
      targetUrl: "http://api.openai.com/v1/responses",
      method: "POST",
      body: `{"model":"gpt-5"}`,
    });

    expect(response.statusCode).toBe(502);
  });

  it("preserves upgraded https streams after switching protocols", async () => {
    const upstreamCa = generateProxyCa();
    const upstreamServer = await startHttpsServer({
      caCertificatePem: upstreamCa.certificatePem,
      caPrivateKeyPem: upstreamCa.privateKeyPem,
      handler: (_request, response) => {
        response.writeHead(404);
        response.end();
      },
      onUpgrade: (_request, socket) => {
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
        );
        socket.once("data", (payloadChunk: Buffer) => {
          expect(payloadChunk.toString("utf8")).toBe("ping\n");
          socket.write("pong\n");
        });
      },
    });

    const proxyCa = generateProxyCa();
    const proxyServer = await startProxyServer({
      runtimePlan: buildProxyMediationRuntimePlan(),
      tokenizerProxyEgressBaseUrl: "http://127.0.0.1:1/tokenizer-proxy/egress",
      certificateAuthority: createCertificateAuthority(
        proxyCa.certificatePem,
        proxyCa.privateKeyPem,
      ),
      trustedCaCertificatesPem: [upstreamCa.certificatePem],
    });

    await expect(
      performHttpsUpgradeProxyRequest({
        proxyBaseUrl: proxyServer.baseUrl,
        targetUrl: `${upstreamServer.baseUrl}/socket`,
        caCertificatePem: proxyCa.certificatePem,
      }),
    ).resolves.toBe("pong\n");
  });
});
