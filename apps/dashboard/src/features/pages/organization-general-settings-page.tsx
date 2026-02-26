import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
} from "@mistle/ui";
import { useEffect, useMemo, useState } from "react";

import { SaveActions } from "../settings/save-actions.js";
import { useOrganizationSummary } from "../shell/use-organization-summary.js";

type OrganizationGeneralFormState = {
  name: string;
  slug: string;
};

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, "-");
}

function isSlugShapeValid(value: string): boolean {
  return /^[a-z0-9-]+$/u.test(value);
}

export function OrganizationGeneralSettingsPage(): React.JSX.Element {
  const organizationSummary = useOrganizationSummary();

  const loadedState = useMemo<OrganizationGeneralFormState>(
    () => ({
      name: organizationSummary.organizationName,
      slug: normalizeSlug(organizationSummary.organizationName),
    }),
    [organizationSummary.organizationName],
  );

  const [savedState, setSavedState] = useState<OrganizationGeneralFormState>(loadedState);
  const [formState, setFormState] = useState<OrganizationGeneralFormState>(loadedState);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setSavedState(loadedState);
    setFormState(loadedState);
    setSaveSuccess(false);
  }, [loadedState]);

  const normalizedName = formState.name.trim();
  const normalizedSlug = normalizeSlug(formState.slug);
  const hasNameError = normalizedName.length === 0;
  const hasSlugError = normalizedSlug.length === 0 || !isSlugShapeValid(normalizedSlug);
  const hasDirtyChanges =
    normalizedName !== savedState.name.trim() || normalizedSlug !== normalizeSlug(savedState.slug);

  function handleSave(): void {
    if (hasNameError || hasSlugError) {
      return;
    }

    const nextState = {
      name: normalizedName,
      slug: normalizedSlug,
    };
    setSavedState(nextState);
    setFormState(nextState);
    setSaveSuccess(true);
  }

  function handleCancel(): void {
    setFormState(savedState);
    setSaveSuccess(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization details</CardTitle>
        <CardDescription>
          Organization settings are UI-only in this slice. Save currently updates local form state.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-4 flex flex-col">
        <p aria-live="polite" className="sr-only" role="status">
          {saveSuccess ? "Organization settings saved." : ""}
        </p>
        {organizationSummary.organizationErrorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>Organization summary is unavailable</AlertTitle>
            <AlertDescription>{organizationSummary.organizationErrorMessage}</AlertDescription>
          </Alert>
        ) : null}
        <Field>
          <FieldLabel htmlFor="organization-name">Organization name</FieldLabel>
          <FieldContent>
            <Input
              id="organization-name"
              onChange={(event) => {
                setFormState((currentState) => ({
                  ...currentState,
                  name: event.target.value,
                }));
                setSaveSuccess(false);
              }}
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
              onChange={(event) => {
                setFormState((currentState) => ({
                  ...currentState,
                  slug: event.target.value,
                }));
                setSaveSuccess(false);
              }}
              value={formState.slug}
            />
          </FieldContent>
          <FieldDescription>Use lowercase letters, numbers, and hyphens.</FieldDescription>
          {normalizedSlug.length === 0 ? (
            <FieldError errors={[{ message: "Slug is required." }]} />
          ) : null}
          {normalizedSlug.length > 0 && !isSlugShapeValid(normalizedSlug) ? (
            <FieldError
              errors={[{ message: "Use lowercase letters, numbers, and hyphens only." }]}
            />
          ) : null}
        </Field>
        <SaveActions
          cancelDisabled={!hasDirtyChanges}
          onCancel={handleCancel}
          onSave={handleSave}
          saveDisabled={!hasDirtyChanges || hasNameError || hasSlugError}
          saveSuccess={saveSuccess}
          saving={false}
        />
      </CardContent>
    </Card>
  );
}
