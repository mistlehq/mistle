import { systemScheduler } from "@mistle/time";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
} from "@mistle/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  checkOrganizationSlug,
  getOrganizationGeneral,
  MembersApiError,
  updateOrganizationGeneral,
} from "../settings/members/members-api.js";
import { SaveActions } from "../settings/save-actions.js";
import { organizationSummaryQueryKey } from "../shell/organization-summary.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";

const SETTINGS_ORGANIZATION_GENERAL_QUERY_KEY_PREFIX: readonly [
  "settings",
  "organization-general",
] = ["settings", "organization-general"];

type SlugAvailability = "unknown" | "checking" | "available" | "unavailable";

type OrganizationFormState = {
  name: string;
  slug: string;
};

function settingsOrganizationGeneralQueryKey(
  organizationId: string,
): readonly ["settings", "organization-general", string] {
  return [
    SETTINGS_ORGANIZATION_GENERAL_QUERY_KEY_PREFIX[0],
    SETTINGS_ORGANIZATION_GENERAL_QUERY_KEY_PREFIX[1],
    organizationId,
  ];
}

function toErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof MembersApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallbackMessage;
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function isSlugShapeValid(slug: string): boolean {
  return /^[a-z0-9-]+$/u.test(slug);
}

export function OrganizationGeneralSettingsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const organizationId = useRequiredOrganizationId();

  const [formState, setFormState] = useState<OrganizationFormState>({
    name: "",
    slug: "",
  });
  const [persistedFormState, setPersistedFormState] = useState<OrganizationFormState>({
    name: "",
    slug: "",
  });
  const [slugAvailability, setSlugAvailability] = useState<SlugAvailability>("unknown");
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const organizationQuery = useQuery({
    queryKey: settingsOrganizationGeneralQueryKey(organizationId),
    queryFn: async () =>
      getOrganizationGeneral({
        organizationId,
      }),
  });

  useEffect(() => {
    if (!organizationQuery.data) {
      return;
    }

    const loadedState = {
      name: organizationQuery.data.name,
      slug: organizationQuery.data.slug,
    };
    setFormState(loadedState);
    setPersistedFormState(loadedState);
    setSlugAvailability("unknown");
  }, [organizationQuery.data]);

  useEffect(() => {
    if (!showSaveSuccess) {
      return;
    }

    const timeoutHandle = systemScheduler.schedule(() => {
      setShowSaveSuccess(false);
    }, 2000);

    return () => {
      systemScheduler.cancel(timeoutHandle);
    };
  }, [showSaveSuccess]);

  const slugCheckMutation = useMutation({
    mutationFn: async (slug: string) => checkOrganizationSlug({ slug }),
  });

  async function refreshSlugAvailability(slugValue: string): Promise<boolean> {
    if (slugValue === persistedFormState.slug) {
      setSlugAvailability("unknown");
      return true;
    }

    setSlugAvailability("checking");
    const isAvailable = await slugCheckMutation.mutateAsync(slugValue);
    setSlugAvailability(isAvailable ? "available" : "unavailable");
    return isAvailable;
  }

  const saveMutation = useMutation({
    mutationFn: async (nextState: OrganizationFormState) =>
      updateOrganizationGeneral({
        organizationId,
        name: nextState.name,
        slug: nextState.slug,
      }),
    onSuccess: async (_result, variables) => {
      queryClient.setQueryData(organizationSummaryQueryKey(organizationId), {
        name: variables.name,
        slug: variables.slug,
      });

      const refetched = await organizationQuery.refetch();
      const latest = refetched.data;
      if (latest) {
        const latestState = {
          name: latest.name,
          slug: latest.slug,
        };
        setFormState(latestState);
        setPersistedFormState(latestState);
        queryClient.setQueryData(organizationSummaryQueryKey(organizationId), latestState);
      }

      await queryClient.invalidateQueries({
        queryKey: organizationSummaryQueryKey(organizationId),
      });

      setShowSaveSuccess(true);
      setSaveError(null);
      setSlugAvailability("unknown");
    },
    onError: (error: unknown) => {
      setSaveError(toErrorMessage(error, "Could not update organization settings."));
      setShowSaveSuccess(false);
    },
  });

  if (organizationQuery.isPending) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-3 w-64" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-20" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (organizationQuery.isError) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Alert variant="destructive">
            <AlertTitle>Could not load organization settings</AlertTitle>
            <AlertDescription>
              {toErrorMessage(organizationQuery.error, "Could not load organization settings.")}
            </AlertDescription>
          </Alert>
          <div>
            <Button
              onClick={() => void organizationQuery.refetch()}
              type="button"
              variant="outline"
            >
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const normalizedName = formState.name.trim();
  const normalizedSlug = normalizeSlug(formState.slug);
  const hasDirtyChanges =
    normalizedName !== persistedFormState.name.trim() || normalizedSlug !== persistedFormState.slug;
  const hasNameError = normalizedName.length === 0;
  const hasSlugError = normalizedSlug.length === 0 || !isSlugShapeValid(normalizedSlug);

  function handleNameChange(nextValue: string): void {
    setFormState((currentState) => ({
      ...currentState,
      name: nextValue,
    }));
    setSaveError(null);
    setShowSaveSuccess(false);
  }

  function handleSlugChange(nextValue: string): void {
    setFormState((currentState) => ({
      ...currentState,
      slug: nextValue,
    }));
    setSlugAvailability("unknown");
    setSaveError(null);
    setShowSaveSuccess(false);
  }

  function handleCancelChanges(): void {
    setFormState(persistedFormState);
    setSlugAvailability("unknown");
    setSaveError(null);
    setShowSaveSuccess(false);
  }

  function canSubmit(): boolean {
    return !(
      !hasDirtyChanges ||
      hasNameError ||
      hasSlugError ||
      saveMutation.isPending ||
      slugCheckMutation.isPending
    );
  }

  async function saveChanges(): Promise<void> {
    if (normalizedSlug !== persistedFormState.slug) {
      const slugIsAvailable = await refreshSlugAvailability(normalizedSlug);
      if (!slugIsAvailable) {
        setSaveError("Slug is unavailable. Choose a different slug.");
        setShowSaveSuccess(false);
        return;
      }
    }

    await saveMutation.mutateAsync({
      name: normalizedName,
      slug: normalizedSlug,
    });
  }

  function handleSaveChanges(): void {
    void saveChanges();
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <p aria-live="polite" className="sr-only" role="status">
          {showSaveSuccess ? "Organization settings updated." : ""}
        </p>

        {saveError ? (
          <Alert variant="destructive">
            <AlertTitle>Update failed</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        ) : null}

        <Field>
          <FieldLabel htmlFor="organization-name">Organization name</FieldLabel>
          <FieldContent>
            <Input
              id="organization-name"
              onChange={(event) => handleNameChange(event.currentTarget.value)}
              value={formState.name}
            />
          </FieldContent>
          {hasNameError ? (
            <FieldError errors={[{ message: "Organization name is required." }]} />
          ) : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="organization-slug">Slug</FieldLabel>
          <FieldContent>
            <Input
              id="organization-slug"
              onBlur={() => {
                if (hasSlugError || normalizedSlug === persistedFormState.slug) {
                  return;
                }

                void refreshSlugAvailability(normalizedSlug);
              }}
              onChange={(event) => handleSlugChange(event.currentTarget.value)}
              value={formState.slug}
            />
          </FieldContent>
          <FieldDescription className="flex items-center gap-2">
            <span>Slug availability will be validated before saving.</span>
            <Badge variant="secondary">
              {slugAvailability === "unknown"
                ? "Unknown"
                : slugAvailability === "checking"
                  ? "Checking"
                  : slugAvailability === "available"
                    ? "Available"
                    : "Unavailable"}
            </Badge>
          </FieldDescription>
          {normalizedSlug.length === 0 ? (
            <FieldError errors={[{ message: "Slug is required." }]} />
          ) : null}
          {normalizedSlug.length > 0 && !isSlugShapeValid(normalizedSlug) ? (
            <FieldError
              errors={[{ message: "Use lowercase letters, numbers, and hyphens only." }]}
            />
          ) : null}
          {slugAvailability === "unavailable" ? (
            <FieldError errors={[{ message: "This slug is already in use." }]} />
          ) : null}
        </Field>

        <SaveActions
          cancelDisabled={!hasDirtyChanges || saveMutation.isPending || slugCheckMutation.isPending}
          onCancel={handleCancelChanges}
          onSave={handleSaveChanges}
          saveDisabled={!canSubmit()}
          saveSuccess={showSaveSuccess}
          saving={saveMutation.isPending}
        />
      </CardContent>
    </Card>
  );
}
