import { fetch as undiciFetch, FormData as UndiciFormData, Headers, Pool } from "undici";
import type { RequestInit as UndiciRequestInit } from "undici";

import type { TestHttpClient, TestHttpRequestInit } from "./types.js";

type SharedHttpPool = {
  origin: string;
  pool: Pool;
  leases: number;
  closePromise: Promise<void> | undefined;
};

const SharedHttpPoolsByOrigin = new Map<string, SharedHttpPool>();
const DefaultMaxConnectionsPerOrigin = 4;

export function createTestHttpClient(input: {
  baseUrl: string;
  defaultHeaders?: ReadonlyMap<string, string>;
}): TestHttpClient {
  const baseUrl = new URL(input.baseUrl);
  const sharedPool = leaseSharedHttpPool(baseUrl.origin);
  let closed = false;

  return {
    fetch: async (path, init) => {
      if (closed) {
        throw new Error(`HTTP client for '${baseUrl.origin}' is already closed.`);
      }

      const url = new URL(path, baseUrl);
      const requestInit = await normalizeRequestInit(init);
      const headers = new Headers(requestInit?.headers);
      for (const [name, value] of input.defaultHeaders ?? []) {
        if (!headers.has(name)) {
          headers.set(name, value);
        }
      }

      return undiciFetch(url, {
        ...requestInit,
        headers,
        dispatcher: sharedPool.pool,
      });
    },
    close: async () => {
      if (closed) {
        return;
      }

      closed = true;
      await releaseSharedHttpPool(sharedPool);
    },
  };
}

async function normalizeRequestInit(
  init: TestHttpRequestInit | undefined,
): Promise<UndiciRequestInit | undefined> {
  if (init === undefined) {
    return undefined;
  }

  const { body, ...requestInit } = init;
  if (body === undefined) {
    return requestInit;
  }

  if (body instanceof globalThis.FormData) {
    return {
      ...requestInit,
      body: await createUndiciFormData(body),
    };
  }

  return {
    ...requestInit,
    body,
  };
}

async function createUndiciFormData(formData: globalThis.FormData): Promise<UndiciFormData> {
  const normalized = new UndiciFormData();

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      normalized.append(key, value);
      continue;
    }

    normalized.append(
      key,
      new File([new Uint8Array(await value.arrayBuffer())], value.name, {
        lastModified: value.lastModified,
        type: value.type,
      }),
    );
  }

  return normalized;
}

function leaseSharedHttpPool(origin: string): SharedHttpPool {
  const existingPool = SharedHttpPoolsByOrigin.get(origin);
  if (existingPool !== undefined) {
    existingPool.leases += 1;
    return existingPool;
  }

  const sharedPool = {
    origin,
    pool: new Pool(origin, {
      connections: DefaultMaxConnectionsPerOrigin,
    }),
    leases: 1,
    closePromise: undefined,
  };
  SharedHttpPoolsByOrigin.set(origin, sharedPool);
  return sharedPool;
}

async function releaseSharedHttpPool(sharedPool: SharedHttpPool): Promise<void> {
  sharedPool.leases -= 1;
  if (sharedPool.leases > 0) {
    return;
  }

  SharedHttpPoolsByOrigin.delete(sharedPool.origin);
  sharedPool.closePromise ??= sharedPool.pool.close();
  await sharedPool.closePromise;
}
