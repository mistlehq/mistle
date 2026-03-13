import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useWebhookAutomationPrerequisites } from "./use-webhook-automation-prerequisites.js";
import {
  toCreateWebhookAutomationPayload,
  toUpdateWebhookAutomationPayload,
  toWebhookAutomationFormValues,
  validateWebhookAutomationFormValues,
} from "./webhook-automation-form-helpers.js";
import type { WebhookAutomationFormValues } from "./webhook-automation-form.js";
import {
  AUTOMATIONS_QUERY_KEY_PREFIX,
  webhookAutomationDetailQueryKey,
} from "./webhook-automations-query-keys.js";
import {
  createWebhookAutomation,
  deleteWebhookAutomation,
  getWebhookAutomation,
  updateWebhookAutomation,
} from "./webhook-automations-service.js";

type NavigateFunction = (to: string) => void | Promise<void>;

type UseWebhookAutomationEditorStateInput = {
  mode: "create" | "edit";
  automationId: string | undefined;
  navigate: NavigateFunction;
};

function newWebhookAutomationDetailQueryKey(): readonly [
  "automations",
  "webhooks",
  "detail",
  "new",
] {
  return ["automations", "webhooks", "detail", "new"];
}

export function useWebhookAutomationEditorState(input: UseWebhookAutomationEditorStateInput): {
  connectionOptions: readonly {
    value: string;
    label: string;
    description?: string;
  }[];
  sandboxProfileOptions: readonly {
    value: string;
    label: string;
    description?: string;
  }[];
  values: WebhookAutomationFormValues;
  fieldErrors: Partial<Record<keyof WebhookAutomationFormValues, string>>;
  formError: string | null;
  pageError: string | null;
  deleteError: string | null;
  isDeleteDialogOpen: boolean;
  isDeleting: boolean;
  isLoadingInitialData: boolean;
  isSaving: boolean;
  onDeleteDialogOpenChange: (isOpen: boolean) => void;
  onRequestDelete: (() => void) | null;
  onConfirmDelete: () => void;
  onSubmit: () => void;
  onValueChange: (key: keyof WebhookAutomationFormValues, value: string | boolean) => void;
} {
  const queryClient = useQueryClient();
  const prerequisites = useWebhookAutomationPrerequisites();
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
      input.automationId === undefined
        ? newWebhookAutomationDetailQueryKey()
        : webhookAutomationDetailQueryKey(input.automationId),
    queryFn: async ({ signal }) => {
      if (input.automationId === undefined) {
        throw new Error("Automation id is required.");
      }

      return getWebhookAutomation({
        automationId: input.automationId,
        signal,
      });
    },
    enabled: input.mode === "edit" && input.automationId !== undefined,
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
      await input.navigate(`/automations/${automation.id}`);
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
      if (input.automationId === undefined) {
        throw new Error("Automation id is required.");
      }

      return updateWebhookAutomation({
        payload: {
          automationId: input.automationId,
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
      if (input.automationId === undefined) {
        throw new Error("Automation id is required.");
      }

      return deleteWebhookAutomation({
        automationId: input.automationId,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: AUTOMATIONS_QUERY_KEY_PREFIX,
      });
      await input.navigate("/automations");
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

  function requestDelete(): void {
    setDeleteError(null);
    setIsDeleteDialogOpen(true);
  }

  function confirmDelete(): void {
    deleteMutation.mutate();
  }

  const isLoadingInitialData =
    prerequisites.isPending || (input.mode === "edit" && automationQuery.isPending);

  const pageError =
    prerequisites.errorMessage !== null || automationQuery.isError
      ? resolveApiErrorMessage({
          error: automationQuery.error,
          fallbackMessage:
            prerequisites.errorMessage ??
            (input.mode === "edit"
              ? "Could not load automation."
              : "Could not load automation form."),
        })
      : null;

  return {
    connectionOptions: prerequisites.connectionOptions,
    sandboxProfileOptions: prerequisites.sandboxProfileOptions,
    values: formValues,
    fieldErrors,
    formError,
    pageError,
    deleteError,
    isDeleteDialogOpen,
    isDeleting: deleteMutation.isPending,
    isLoadingInitialData,
    isSaving: createMutation.isPending || updateMutation.isPending,
    onDeleteDialogOpenChange: setIsDeleteDialogOpen,
    onRequestDelete: input.mode === "edit" ? requestDelete : null,
    onConfirmDelete: confirmDelete,
    onSubmit: submitForm,
    onValueChange,
  };
}
