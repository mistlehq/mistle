import { useQuery } from "@tanstack/react-query";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { listSandboxProfiles } from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";
import { buildWebhookTriggerSandboxProfileOptions } from "./webhook-trigger-option-builders.js";

export const TRIGGER_SANDBOX_PROFILES_QUERY_KEY: readonly ["triggers", "sandbox-profiles"] = [
  "triggers",
  "sandbox-profiles",
];

async function listAllSandboxProfiles(input: {
  signal?: AbortSignal;
}): Promise<readonly SandboxProfile[]> {
  const items: SandboxProfile[] = [];
  let after: string | null = null;

  for (;;) {
    const result = await listSandboxProfiles({
      limit: 100,
      after,
      before: null,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    items.push(...result.items);

    if (result.nextPage === null) {
      return items;
    }

    after = result.nextPage.after;
  }
}

export function useTriggerSandboxProfileOptions(): {
  sandboxProfileOptions: ReturnType<typeof buildWebhookTriggerSandboxProfileOptions>;
  errorMessage: string | null;
  isPending: boolean;
} {
  const sandboxProfilesQuery = useQuery({
    queryKey: TRIGGER_SANDBOX_PROFILES_QUERY_KEY,
    queryFn: async ({ signal }) => listAllSandboxProfiles({ signal }),
    retry: false,
  });

  const sandboxProfileOptions =
    sandboxProfilesQuery.data === undefined
      ? []
      : buildWebhookTriggerSandboxProfileOptions({
          sandboxProfiles: sandboxProfilesQuery.data,
        });

  const errorMessage = sandboxProfilesQuery.isError
    ? resolveApiErrorMessage({
        error: sandboxProfilesQuery.error,
        fallbackMessage: "Could not load trigger prerequisites.",
      })
    : null;

  return {
    sandboxProfileOptions,
    errorMessage,
    isPending: sandboxProfilesQuery.isPending,
  };
}
