import { Template, type BuildInfo, type ConnectionOpts, type LogEntry } from "e2b";

import { E2BClientOperationIds, mapE2BClientError } from "./client-errors.js";
import { E2BDefaultTemplateCpuCount, E2BDefaultTemplateMemoryMb } from "./schemas.js";
import { createE2BTemplateAlias } from "./template-registry.js";

export type EnsureE2BTemplateAliasInput = {
  baseRef: string;
  connectionOptions: ConnectionOpts;
  cpuCount?: number;
  memoryMb?: number;
  onBuildLogs?: (logEntry: LogEntry) => void;
};

export type EnsureE2BTemplateAliasResult = {
  alias: string;
  templateExists: boolean;
  buildInfo?: BuildInfo;
};

export async function ensureE2BTemplateAlias(
  input: EnsureE2BTemplateAliasInput,
): Promise<EnsureE2BTemplateAliasResult> {
  try {
    const cpuCount = input.cpuCount ?? E2BDefaultTemplateCpuCount;
    const memoryMb = input.memoryMb ?? E2BDefaultTemplateMemoryMb;
    const alias = createE2BTemplateAlias({
      baseRef: input.baseRef,
      cpuCount,
      memoryMb,
    });
    const templateExists = await Template.exists(alias, input.connectionOptions);

    if (templateExists) {
      return {
        alias,
        templateExists,
      };
    }

    const template = Template().fromImage(input.baseRef);
    const buildInfo = await Template.build(template, alias, {
      ...input.connectionOptions,
      cpuCount,
      memoryMB: memoryMb,
      ...(input.onBuildLogs === undefined ? {} : { onBuildLogs: input.onBuildLogs }),
    });

    return {
      alias,
      templateExists,
      buildInfo,
    };
  } catch (error) {
    throw mapE2BClientError(E2BClientOperationIds.RESOLVE_TEMPLATE_ALIAS, error);
  }
}
