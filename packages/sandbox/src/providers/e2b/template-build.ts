import { Template, type BuildInfo, type ConnectionOpts, type LogEntry } from "e2b";

import { E2BClientOperationIds, mapE2BClientError } from "./client-errors.js";
import { createE2BTemplateAlias } from "./template-registry.js";

export type EnsureE2BTemplateAliasInput = {
  baseRef: string;
  connectionOptions: ConnectionOpts;
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
    const alias = createE2BTemplateAlias(input.baseRef);
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
