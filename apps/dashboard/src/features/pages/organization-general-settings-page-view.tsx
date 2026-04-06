import { Avatar, AvatarFallback, AvatarImage, Button, Notice, Skeleton } from "@mistle/ui";
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
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="h-8 w-8">
              {props.logoUrl === null ? null : (
                <AvatarImage alt={`${props.name} logo`} src={props.logoUrl} />
              )}
              <AvatarFallback>{deriveInitials({ name: props.name, fallback: "O" })}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{props.name}</p>
              <p className="text-muted-foreground truncate text-xs">Organization logo</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
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
            <Button
              disabled={props.logoBusy}
              onClick={() => {
                fileInputRef.current?.click();
              }}
              type="button"
              variant="outline"
            >
              {props.logoUrl === null ? "Upload logo" : "Replace logo"}
            </Button>
            <Button
              disabled={props.logoBusy || props.logoUrl === null}
              onClick={() => {
                void props.onDeleteLogo().catch(() => {});
              }}
              type="button"
              variant="ghost"
            >
              Remove logo
            </Button>
          </div>
          <label className="sr-only" htmlFor={fileInputId}>
            Upload organization logo
          </label>
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
