import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Notice,
  Skeleton,
} from "@mistle/ui";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useId, useRef } from "react";

import { AutoSaveTextField } from "../forms/auto-save-text-field.js";
import { FormPageSection, FormPageStack } from "../shared/form-page.js";

export type OrganizationGeneralSettingsPageViewProps = {
  isLoading: boolean;
  isSaving: boolean;
  loadErrorMessage: string | null;
  logoBusy: boolean;
  logoErrorMessage: string | null;
  logoUrl: string | null;
  name: string;
  onDeleteLogo: () => Promise<void>;
  onSaveChanges: (name: string) => Promise<void>;
  onUploadLogo: (file: File) => Promise<void>;
};

export function OrganizationGeneralSettingsPageView(
  props: OrganizationGeneralSettingsPageViewProps,
): React.JSX.Element {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (props.isLoading) {
    return (
      <FormPageStack>
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
          </div>
        </FormPageSection>
      </FormPageStack>
    );
  }

  if (props.loadErrorMessage) {
    return (
      <FormPageStack>
        <FormPageSection>
          <div className="flex flex-col gap-3 p-4">
            <Notice variant="alert">{props.loadErrorMessage} Please try again later.</Notice>
          </div>
        </FormPageSection>
      </FormPageStack>
    );
  }

  return (
    <FormPageStack>
      <FormPageSection>
        <div className="divide-y">
          <Field className="p-4" contentWidth="fill" orientation="horizontal">
            <FieldHeader>
              <FieldLabel>Logo</FieldLabel>
              <FieldDescription>Recommended size is 256x256px</FieldDescription>
            </FieldHeader>
            <FieldContent className="items-end">
              <input
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={props.logoBusy}
                id={fileInputId}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] ?? null;
                  event.currentTarget.value = "";
                  if (file === null) {
                    return;
                  }

                  void props.onUploadLogo(file).catch(() => {});
                }}
                ref={fileInputRef}
                type="file"
              />
              <button
                aria-label={
                  props.logoUrl === null ? "Upload organization logo" : "Edit organization logo"
                }
                className="group relative rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                disabled={props.logoBusy}
                onClick={() => {
                  fileInputRef.current?.click();
                }}
                type="button"
              >
                <Avatar className="bg-muted border-border h-16 w-16 rounded-2xl border">
                  {props.logoUrl === null ? null : (
                    <AvatarImage alt={`${props.name} logo`} src={props.logoUrl} />
                  )}
                  <AvatarFallback className="rounded-2xl text-base">
                    {deriveInitials({ name: props.name, fallback: "O" })}
                  </AvatarFallback>
                </Avatar>
                <span className="bg-background/75 absolute inset-0 flex items-center justify-center rounded-2xl opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                  <span className="bg-background text-foreground border-border flex h-9 w-9 items-center justify-center rounded-full border shadow-sm">
                    <PencilSimpleIcon aria-hidden className="size-4" />
                  </span>
                </span>
              </button>
              <label className="sr-only" htmlFor={fileInputId}>
                Upload organization logo
              </label>
              {props.logoUrl === null ? null : (
                <Button
                  className="mt-2"
                  disabled={props.logoBusy}
                  onClick={() => {
                    void props.onDeleteLogo().catch(() => {});
                  }}
                  type="button"
                  variant="ghost"
                >
                  Remove logo
                </Button>
              )}
            </FieldContent>
          </Field>
        </div>
        {props.logoErrorMessage === null ? null : (
          <div className="px-4 pb-4">
            <Notice variant="alert">{props.logoErrorMessage} Please try again later.</Notice>
          </div>
        )}
        {props.logoBusy ? (
          <p className="text-muted-foreground px-4 pb-4 text-sm">Updating organization logo...</p>
        ) : null}
        <div aria-live="polite" className="sr-only" role="status">
          {props.logoBusy ? "Updating organization logo" : ""}
        </div>
      </FormPageSection>

      <FormPageSection>
        <div className="flex flex-col gap-4 p-4">
          <AutoSaveTextField
            disabled={props.isSaving}
            id="organization-name"
            label="Organization name"
            onSave={props.onSaveChanges}
            validate={(nextValue) => {
              return nextValue.trim().length === 0 ? "Organization name is required." : null;
            }}
            value={props.name}
          />
        </div>
      </FormPageSection>
    </FormPageStack>
  );
}

function deriveInitials(input: { name: string; fallback: string }): string {
  const words = input.name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) {
    return input.fallback;
  }

  const initials = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return initials.length > 0 ? initials : input.fallback;
}
