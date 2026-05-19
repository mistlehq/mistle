import {
  Button,
  Checkbox,
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
  Input,
  Notice,
} from "@mistle/ui";
import { PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";

import {
  ApiKeyPermissionOptions,
  DefaultApiKeyPermissions,
} from "../settings/api-keys/api-key-permissions.js";
import { FormPageSection, FormPageStack } from "../shared/form-page.js";

export type OrganizationApiKeyCreatePageViewProps = {
  createErrorMessage: string | null;
  isCreating: boolean;
  onCreateApiKey: (input: { name: string; permissions: readonly string[] }) => void;
};

export function OrganizationApiKeyCreatePageView(
  props: OrganizationApiKeyCreatePageViewProps,
): React.JSX.Element {
  const [name, setName] = useState("");
  const [selectedPermissions, setSelectedPermissions] =
    useState<readonly string[]>(DefaultApiKeyPermissions);
  const trimmedName = name.trim();
  const canCreate = trimmedName.length > 0 && selectedPermissions.length > 0 && !props.isCreating;

  return (
    <FormPageStack>
      <FormPageSection>
        <form
          className="flex flex-col gap-4 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canCreate) {
              return;
            }

            props.onCreateApiKey({
              name: trimmedName,
              permissions: selectedPermissions,
            });
            setName("");
          }}
        >
          {props.createErrorMessage === null ? null : (
            <Notice variant="alert">{props.createErrorMessage}</Notice>
          )}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
              <FieldContent>
                <Input
                  autoComplete="off"
                  id="api-key-name"
                  onChange={(event) => {
                    setName(event.currentTarget.value);
                  }}
                  placeholder="Production deploy key"
                  value={name}
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel>Permissions</FieldLabel>
              <FieldContent>
                <div className="grid gap-2">
                  {ApiKeyPermissionOptions.map((option) => (
                    <label
                      className="flex gap-3 rounded-md border bg-background p-3 text-sm"
                      key={option.value}
                    >
                      <Checkbox
                        aria-label={option.label}
                        checked={selectedPermissions.includes(option.value)}
                        onCheckedChange={(checked) => {
                          setSelectedPermissions((current) =>
                            checked === true
                              ? [...current, option.value]
                              : current.filter((permission) => permission !== option.value),
                          );
                        }}
                      />
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="font-medium">{option.label}</span>
                        <span className="text-muted-foreground">{option.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </FieldContent>
            </Field>
          </FieldGroup>
          <div className="flex justify-end">
            <Button disabled={!canCreate} type="submit">
              <PlusIcon aria-hidden />
              {props.isCreating ? "Creating..." : "Create API key"}
            </Button>
          </div>
        </form>
      </FormPageSection>
    </FormPageStack>
  );
}
