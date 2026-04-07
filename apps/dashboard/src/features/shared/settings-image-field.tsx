import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  cn,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Spinner,
} from "@mistle/ui";
import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { useId, useRef } from "react";

import { deriveInitials } from "./derive-initials.js";

export type SettingsImageFieldProps = {
  alt: string;
  busy: boolean;
  errorMessage: string | null;
  fallbackInitial: string;
  imageUrl: string | null;
  imageName: string;
  label: string;
  name: string;
  onDelete: () => Promise<void>;
  onUpload: (file: File) => Promise<void>;
};

export function SettingsImageField(props: SettingsImageFieldProps): React.JSX.Element {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadLabel = `Upload ${props.imageName}`;
  const editLabel = `Edit ${props.imageName}`;
  const removeLabel = `Remove ${props.imageName}`;
  const busyAnnouncement = `Updating ${props.imageName}`;

  return (
    <Field contentWidth="fill" orientation="horizontal">
      <FieldHeader>
        <FieldLabel>{props.label}</FieldLabel>
      </FieldHeader>
      <FieldContent className="md:items-end">
        <input
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={props.busy}
          id={fileInputId}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = "";
            if (file === null) {
              return;
            }

            void props.onUpload(file).catch(() => {});
          }}
          ref={fileInputRef}
          type="file"
        />
        <div className="flex items-center gap-2">
          <button
            aria-label={props.imageUrl === null ? uploadLabel : editLabel}
            className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            disabled={props.busy}
            onClick={() => {
              fileInputRef.current?.click();
            }}
            type="button"
          >
            <Avatar
              className={cn(
                "bg-muted border-border h-10 w-10 rounded-full border after:border-0",
                props.errorMessage === null ? null : "border-destructive",
              )}
            >
              {props.imageUrl === null ? null : (
                <AvatarImage alt={props.alt} src={props.imageUrl} />
              )}
              <AvatarFallback className="rounded-full text-sm">
                {deriveInitials({ name: props.name, fallback: props.fallbackInitial })}
              </AvatarFallback>
            </Avatar>
            <span
              className={cn(
                "absolute inset-0 flex items-center justify-center rounded-full bg-black/50 transition-opacity duration-150",
                props.busy
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
              )}
            >
              {props.busy ? (
                <Spinner aria-label={busyAnnouncement} className="size-4 text-white" />
              ) : (
                <PencilSimpleIcon aria-hidden className="size-4 text-white" weight="fill" />
              )}
            </span>
          </button>
          {props.imageUrl === null ? null : (
            <Button
              aria-label={removeLabel}
              className="h-10 w-10 p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
              disabled={props.busy}
              onClick={() => {
                void props.onDelete().catch(() => {});
              }}
              type="button"
              variant="ghost"
            >
              <TrashIcon aria-hidden className="size-4" />
            </Button>
          )}
        </div>
        <label className="sr-only" htmlFor={fileInputId}>
          {uploadLabel}
        </label>
        {props.errorMessage === null ? null : (
          <p className="text-destructive max-w-44 text-right text-xs leading-normal">
            {props.errorMessage}
          </p>
        )}
        <div aria-live="polite" className="sr-only" role="status">
          {props.busy ? busyAnnouncement : ""}
        </div>
      </FieldContent>
    </Field>
  );
}
