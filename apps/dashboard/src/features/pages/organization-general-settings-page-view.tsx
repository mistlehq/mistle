import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Field,
  FieldContent,
  FieldError,
  FieldHeader,
  FieldLabel,
  Input,
  Skeleton,
} from "@mistle/ui";
import { useRef } from "react";

import { SaveActions } from "../settings/save-actions.js";
import { FormPageSection, FormPageShell } from "../shared/form-page.js";

export type OrganizationGeneralSettingsPageViewProps = {
  hasDirtyChanges: boolean;
  isLogoMutating: boolean;
  isLoading: boolean;
  isSaving: boolean;
  loadErrorMessage: string | null;
  logoErrorMessage: string | null;
  logoUrl: string | null;
  name: string;
  nameErrorMessage: string | null;
  onCancelChanges: () => void;
  onLogoFileSelected: (file: File) => void;
  onLogoRemove: () => void;
  onNameChange: (nextValue: string) => void;
  onRetryLoad: () => void;
  onSaveChanges: () => void;
  saveErrorMessage: string | null;
  saveSuccess: boolean;
};

export function OrganizationGeneralSettingsPageView(
  props: OrganizationGeneralSettingsPageViewProps,
): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (props.isLoading) {
    return (
      <FormPageShell className="pt-0">
        <FormPageSection>
          <div className="flex flex-col gap-4 p-4">
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
          </div>
        </FormPageSection>
      </FormPageShell>
    );
  }

  if (props.loadErrorMessage) {
    return (
      <FormPageShell className="pt-0">
        <FormPageSection>
          <div className="flex flex-col gap-3 p-4">
            <Alert variant="destructive">
              <AlertTitle>Could not load organization settings</AlertTitle>
              <AlertDescription>{props.loadErrorMessage}</AlertDescription>
            </Alert>
            <div>
              <Button onClick={props.onRetryLoad} type="button" variant="outline">
                Retry
              </Button>
            </div>
          </div>
        </FormPageSection>
      </FormPageShell>
    );
  }

  return (
    <FormPageShell className="pt-0">
      <FormPageSection>
        <div className="flex flex-col gap-4 p-4">
          <p aria-live="polite" className="sr-only" role="status">
            {props.saveSuccess ? "Organization settings updated." : ""}
          </p>

          {props.saveErrorMessage ? (
            <Alert variant="destructive">
              <AlertTitle>Update failed</AlertTitle>
              <AlertDescription>{props.saveErrorMessage}</AlertDescription>
            </Alert>
          ) : null}

          <Field contentWidth="fill" orientation="horizontal">
            <FieldHeader>
              <FieldLabel>Organization logo</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <div className="flex flex-wrap items-center gap-3">
                <Avatar size="lg">
                  {props.logoUrl ? (
                    <AvatarImage alt={`${props.name || "Organization"} logo`} src={props.logoUrl} />
                  ) : null}
                  <AvatarFallback>{deriveInitials(props.name)}</AvatarFallback>
                </Avatar>
                <input
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file !== undefined) {
                      props.onLogoFileSelected(file);
                    }
                  }}
                  ref={fileInputRef}
                  type="file"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={props.isLogoMutating}
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    type="button"
                    variant="outline"
                  >
                    {props.isLogoMutating
                      ? "Uploading..."
                      : props.logoUrl
                        ? "Replace logo"
                        : "Upload logo"}
                  </Button>
                  {props.logoUrl ? (
                    <Button
                      disabled={props.isLogoMutating}
                      onClick={props.onLogoRemove}
                      type="button"
                      variant="outline"
                    >
                      Remove logo
                    </Button>
                  ) : null}
                </div>
              </div>
            </FieldContent>
            {props.logoErrorMessage ? (
              <FieldError errors={[{ message: props.logoErrorMessage }]} />
            ) : null}
          </Field>

          <Field contentWidth="fill" orientation="horizontal">
            <FieldHeader>
              <FieldLabel htmlFor="organization-name">Organization name</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <Input
                id="organization-name"
                onChange={(event) => props.onNameChange(event.currentTarget.value)}
                value={props.name}
              />
            </FieldContent>
            {props.nameErrorMessage ? (
              <FieldError errors={[{ message: props.nameErrorMessage }]} />
            ) : null}
          </Field>
        </div>
      </FormPageSection>

      <SaveActions
        cancelDisabled={!props.hasDirtyChanges || props.isSaving}
        onCancel={props.onCancelChanges}
        onSave={props.onSaveChanges}
        saveDisabled={!props.hasDirtyChanges || props.nameErrorMessage !== null || props.isSaving}
        saveSuccess={props.saveSuccess}
        saving={props.isSaving}
      />
    </FormPageShell>
  );
}

function deriveInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) {
    return "O";
  }

  const initials = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return initials.length > 0 ? initials : "O";
}
