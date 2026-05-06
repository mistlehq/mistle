import { createHash } from "node:crypto";

import type { ConnectionOpts } from "e2b";

import { ensureE2BTemplateAlias } from "./template-build.js";

const E2BTemplateAliasPrefix = "mistle-sandbox-base";
export const E2BTemplateDefaultTag = "default";

export type CreateE2BTemplateAliasInput = {
  baseRef: string;
  cpuCount: number;
  memoryMb: number;
};

export interface E2BTemplateRegistry {
  resolveAlias(baseRef: string): Promise<string>;
}

export function createE2BTemplateAlias(input: CreateE2BTemplateAliasInput): string {
  const hashInput = JSON.stringify({
    baseRef: input.baseRef,
    cpuCount: input.cpuCount,
    memoryMb: input.memoryMb,
  });
  const hash = createHash("sha256").update(hashInput).digest("hex");
  return `${E2BTemplateAliasPrefix}-${hash.slice(0, 24)}`;
}

export function createE2BTemplateStartRef(alias: string): string {
  return `${alias}:${E2BTemplateDefaultTag}`;
}

export class E2BApiTemplateRegistry implements E2BTemplateRegistry {
  readonly #connectionOptions: ConnectionOpts;
  readonly #cpuCount: number | undefined;
  readonly #lockDirectoryPath: string | undefined;
  readonly #memoryMb: number | undefined;
  readonly #aliasPromisesByBaseRef = new Map<string, Promise<string>>();

  constructor(
    connectionOptions: ConnectionOpts,
    templateResources?: {
      cpuCount?: number;
      lockDirectoryPath?: string;
      memoryMb?: number;
    },
  ) {
    this.#connectionOptions = connectionOptions;
    this.#cpuCount = templateResources?.cpuCount;
    this.#lockDirectoryPath = templateResources?.lockDirectoryPath;
    this.#memoryMb = templateResources?.memoryMb;
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
      ...(this.#cpuCount === undefined ? {} : { cpuCount: this.#cpuCount }),
      ...(this.#lockDirectoryPath === undefined
        ? {}
        : { lockDirectoryPath: this.#lockDirectoryPath }),
      ...(this.#memoryMb === undefined ? {} : { memoryMb: this.#memoryMb }),
    });

    return result.alias;
  }
}
