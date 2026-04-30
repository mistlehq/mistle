import { fetch as undiciFetch, Pool } from "undici";

import type { TestHttpClient } from "./types.js";

type SharedHttpPool = {
  origin: string;
  pool: Pool;
  leases: number;
  closePromise: Promise<void> | undefined;
};

const SharedHttpPoolsByOrigin = new Map<string, SharedHttpPool>();
const DefaultMaxConnectionsPerOrigin = 4;

export function createTestHttpClient(input: { baseUrl: string }): TestHttpClient {
  const baseUrl = new URL(input.baseUrl);
  const sharedPool = leaseSharedHttpPool(baseUrl.origin);
  let closed = false;

  return {
    fetch: async (path, init) => {
      if (closed) {
        throw new Error(`HTTP client for '${baseUrl.origin}' is already closed.`);
      }

      const url = new URL(path, baseUrl);
      return undiciFetch(url, {
        ...init,
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
