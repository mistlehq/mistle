import { createHash } from "node:crypto";

import type { ConnectionOpts } from "e2b";

import { ensureE2BTemplateAlias } from "./template-build.js";

const E2BTemplateAliasPrefix = "mistle-sandbox-base";

export interface E2BTemplateRegistry {
  resolveAlias(baseRef: string): Promise<string>;
}

export function createE2BTemplateAlias(baseRef: string): string {
  const hash = createHash("sha256").update(baseRef).digest("hex");
  return `${E2BTemplateAliasPrefix}-${hash.slice(0, 24)}`;
}

export class E2BApiTemplateRegistry implements E2BTemplateRegistry {
  readonly #connectionOptions: ConnectionOpts;
  readonly #aliasPromisesByBaseRef = new Map<string, Promise<string>>();

  constructor(connectionOptions: ConnectionOpts) {
    this.#connectionOptions = connectionOptions;
  }

  async resolveAlias(baseRef: string): Promise<string> {
    const existingAliasPromise = this.#aliasPromisesByBaseRef.get(baseRef);
    if (existingAliasPromise !== undefined) {
      return existingAliasPromise;
    }

    const aliasPromise = this.#resolveOrBuildAlias(baseRef);
    this.#aliasPromisesByBaseRef.set(baseRef, aliasPromise);

    try {
      return await aliasPromise;
    } catch (error) {
      this.#aliasPromisesByBaseRef.delete(baseRef);
      throw error;
    }
  }

  async #resolveOrBuildAlias(baseRef: string): Promise<string> {
    const result = await ensureE2BTemplateAlias({
      baseRef,
      connectionOptions: this.#connectionOptions,
    });

    return result.alias;
  }
}
