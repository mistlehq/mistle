import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent } from "@mistle/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { DeleteWebhookAutomationDialog } from "../automations/delete-webhook-automation-dialog.js";
import {
  WebhookAutomationForm,
  type WebhookAutomationFormValues,
} from "../automations/webhook-automation-form.js";
import {
  buildWebhookAutomationConnectionOptions,
  buildWebhookAutomationSandboxProfileOptions,
  toCreateWebhookAutomationPayload,
  toUpdateWebhookAutomationPayload,
  toWebhookAutomationFormValues,
  validateWebhookAutomationFormValues,
} from "../automations/webhook-automations-page-helpers.js";
import {
  webhookAutomationDetailQueryKey,
  AUTOMATIONS_QUERY_KEY_PREFIX,
} from "../automations/webhook-automations-query-keys.js";
import {
  createWebhookAutomation,
  deleteWebhookAutomation,
  getWebhookAutomation,
  updateWebhookAutomation,
} from "../automations/webhook-automations-service.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import { listSandboxProfiles } from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";

type WebhookAutomationEditorPageProps = {
  mode: "create" | "edit";
};

const SANDBOX_PROFILES_QUERY_KEY: readonly ["automations", "sandbox-profiles"] = [
  "automations",
  "sandbox-profiles",
];
const INTEGRATION_DIRECTORY_QUERY_KEY: readonly ["automations", "integration-directory"] = [
  "automations",
  "integration-directory",
];

function newWebhookAutomationDetailQueryKey(): readonly [
  "automations",
  "webhooks",
  "detail",
  "new",
] {
  return ["automations", "webhooks", "detail", "new"];
}

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

export function WebhookAutomationEditorPage(
  input: WebhookAutomationEditorPageProps,
): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams();
  const automationId = input.mode === "edit" ? params["automationId"] : undefined;
  const [formValues, setFormValues] = useState<WebhookAutomationFormValues>(() =>
    toWebhookAutomationFormValues(null),
  );
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof WebhookAutomationFormValues, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const automationQuery = useQuery({
    queryKey:
      automationId === undefined
        ? newWebhookAutomationDetailQueryKey()
        : webhookAutomationDetailQueryKey(automationId),
    queryFn: async ({ signal }) => {
      if (automationId === undefined) {
        throw new Error("Automation id is required.");
      }

      return getWebhookAutomation({
        automationId,
        signal,
      });
    },
    enabled: input.mode === "edit" && automationId !== undefined,
    retry: false,
  });

  const integrationDirectoryQuery = useQuery({
    queryKey: INTEGRATION_DIRECTORY_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    retry: false,
  });

  const sandboxProfilesQuery = useQuery({
    queryKey: SANDBOX_PROFILES_QUERY_KEY,
    queryFn: async ({ signal }) => listAllSandboxProfiles({ signal }),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async (values: WebhookAutomationFormValues) =>
      createWebhookAutomation({
        payload: toCreateWebhookAutomationPayload(values),
      }),
    onSuccess: async (automation) => {
      setFormError(null);
      await queryClient.invalidateQueries({
        queryKey: AUTOMATIONS_QUERY_KEY_PREFIX,
      });
      await navigate(`/automations/${automation.id}`);
    },
    onError: (error: unknown) => {
      setFormError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not create automation.",
        }),
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (values: WebhookAutomationFormValues) => {
      if (automationId === undefined) {
        throw new Error("Automation id is required.");
      }

      return updateWebhookAutomation({
        payload: {
          automationId,
          payload: toUpdateWebhookAutomationPayload(values),
        },
      });
    },
    onSuccess: async (automation) => {
      setFormError(null);
      setFormValues(toWebhookAutomationFormValues(automation));
      await queryClient.invalidateQueries({
        queryKey: AUTOMATIONS_QUERY_KEY_PREFIX,
      });
    },
    onError: (error: unknown) => {
      setFormError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not update automation.",
        }),
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (automationId === undefined) {
        throw new Error("Automation id is required.");
      }

      return deleteWebhookAutomation({
        automationId,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: AUTOMATIONS_QUERY_KEY_PREFIX,
      });
      await navigate("/automations");
    },
    onError: (error: unknown) => {
      setDeleteError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not delete automation.",
        }),
      );
    },
  });

  const isLoadingInitialData =
    integrationDirectoryQuery.isPending ||
    sandboxProfilesQuery.isPending ||
    (input.mode === "edit" && automationQuery.isPending);

  const pageError =
    integrationDirectoryQuery.isError || sandboxProfilesQuery.isError || automationQuery.isError
      ? resolveApiErrorMessage({
          error:
            integrationDirectoryQuery.error ?? sandboxProfilesQuery.error ?? automationQuery.error,
          fallbackMessage:
            input.mode === "edit"
              ? "Could not load automation."
              : "Could not load automation form.",
        })
      : null;

  const connectionOptions = useMemo(
    () =>
      integrationDirectoryQuery.data === undefined
        ? []
        : buildWebhookAutomationConnectionOptions({
            connections: integrationDirectoryQuery.data.connections,
            targets: integrationDirectoryQuery.data.targets,
          }),
    [integrationDirectoryQuery.data],
  );

  const sandboxProfileOptions = useMemo(
    () =>
      sandboxProfilesQuery.data === undefined
        ? []
        : buildWebhookAutomationSandboxProfileOptions({
            sandboxProfiles: sandboxProfilesQuery.data,
          }),
    [sandboxProfilesQuery.data],
  );

  useEffect(() => {
    if (input.mode === "edit" && automationQuery.data !== undefined) {
      setFormValues(toWebhookAutomationFormValues(automationQuery.data));
      setFieldErrors({});
      setFormError(null);
    }
  }, [automationQuery.data, input.mode]);

  function onValueChange(key: keyof WebhookAutomationFormValues, value: string | boolean): void {
    setFormValues((currentValues) => ({
      ...currentValues,
      [key]: value,
    }));
    setFieldErrors((currentErrors) => ({
      ...currentErrors,
      [key]: undefined,
    }));
    setFormError(null);
  }

  function submitForm(): void {
    const nextFieldErrors = validateWebhookAutomationFormValues(formValues);
    setFieldErrors(nextFieldErrors);
    setFormError(null);

    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }

    if (input.mode === "create") {
      createMutation.mutate(formValues);
      return;
    }

    updateMutation.mutate(formValues);
  }

  if (pageError !== null && !isLoadingInitialData) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="destructive">
          <AlertTitle>
            {input.mode === "edit" ? "Could not load automation" : "Could not load form"}
          </AlertTitle>
          <AlertDescription>{pageError}</AlertDescription>
        </Alert>
        <div>
          <Button
            onClick={() => {
              void navigate("/automations");
            }}
            type="button"
            variant="outline"
          >
            Back to automations
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {isLoadingInitialData ? (
        <Card>
          <CardContent className="pt-4">Loading automation…</CardContent>
        </Card>
      ) : null}

      {isLoadingInitialData ? null : (
        <>
          <WebhookAutomationForm
            connectionOptions={connectionOptions}
            fieldErrors={fieldErrors}
            formError={formError}
            isDeleting={deleteMutation.isPending}
            isSaving={createMutation.isPending || updateMutation.isPending}
            mode={input.mode}
            onDelete={
              input.mode === "edit"
                ? () => {
                    setDeleteError(null);
                    setIsDeleteDialogOpen(true);
                  }
                : null
            }
            onSubmit={submitForm}
            onValueChange={onValueChange}
            sandboxProfileOptions={sandboxProfileOptions}
            values={formValues}
          />

          {input.mode === "edit" ? (
            <DeleteWebhookAutomationDialog
              automationName={formValues.name}
              errorMessage={deleteError}
              isOpen={isDeleteDialogOpen}
              isPending={deleteMutation.isPending}
              onConfirm={() => {
                deleteMutation.mutate();
              }}
              onOpenChange={setIsDeleteDialogOpen}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
