import {
  Badge,
  Button,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";
import { useEffect, useState } from "react";

import { AutoSaveTextField } from "../forms/auto-save-text-field.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import type {
  LinkedAccountCallbackNotice,
  LinkedAccountCardViewModel,
} from "../settings/identity-linking/linked-accounts-model.js";
import { FormPageSection, FormPageStack } from "../shared/form-page.js";
import { SettingsImageField } from "../shared/settings-image-field.js";

export type ProfileSettingsPageViewProps = {
  displayName: string;
  email: string;
  imageUrl: string | null;
  linkedAccountActionPending: boolean;
  linkedAccountCallbackNotice: LinkedAccountCallbackNotice | null;
  linkedAccountCards: readonly LinkedAccountCardViewModel[];
  linkedAccountErrorMessage: string | null;
  linkedAccountsEmptyStateMessage: string | null;
  linkedAccountsLoading: boolean;
  linkedAccountsLoadErrorMessage: string | null;
  onDeleteProfileImage: () => Promise<void>;
  onLinkLinkedAccount: (providerFamily: string) => Promise<void>;
  onSaveChanges: (displayName: string) => Promise<void>;
  onUnlinkLinkedAccount: (providerFamily: string) => Promise<void>;
  onUpdateLinkedAccountPreferredEmail: (
    providerFamily: string,
    preferredEmail: string,
  ) => Promise<void>;
  onUploadProfileImage: (file: File) => Promise<void>;
  profileImageBusy: boolean;
  profileImageErrorMessage: string | null;
  saving: boolean;
};

export function ProfileSettingsPageView(props: ProfileSettingsPageViewProps): React.JSX.Element {
  return (
    <FormPageStack>
      <FormPageSection>
        <div className="flex flex-col gap-4 p-4">
          <SettingsImageField
            alt={`${props.displayName} profile image`}
            busy={props.profileImageBusy}
            errorMessage={props.profileImageErrorMessage}
            fallbackInitial="U"
            imageUrl={props.imageUrl}
            imageName="profile image"
            label="Avatar"
            name={props.displayName}
            onDelete={props.onDeleteProfileImage}
            onUpload={props.onUploadProfileImage}
          />
          <AutoSaveTextField
            disabled={props.saving}
            id="display-name"
            label="Display name"
            onSave={props.onSaveChanges}
            validate={() => null}
            value={props.displayName}
          />
          <Field contentWidth="fill" orientation="horizontal">
            <FieldHeader>
              <FieldLabel>Email</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <Input disabled readOnly value={props.email} />
            </FieldContent>
          </Field>
        </div>
      </FormPageSection>
      {shouldRenderLinkedAccountsSection(props) ? (
        <FormPageSection>
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold">Linked Accounts</h2>
              <p className="text-sm text-muted-foreground">
                Link external accounts so Mistle can attribute work to you.
              </p>
            </div>

            {props.linkedAccountCallbackNotice === null ? null : (
              <Notice
                title={props.linkedAccountCallbackNotice.title}
                variant={props.linkedAccountCallbackNotice.variant}
              >
                {props.linkedAccountCallbackNotice.message}
              </Notice>
            )}

            {props.linkedAccountsLoading ? (
              <div className="text-sm text-muted-foreground">Loading linked accounts…</div>
            ) : props.linkedAccountsLoadErrorMessage !== null ? (
              <Notice variant="alert">
                {props.linkedAccountsLoadErrorMessage} Please try again later.
              </Notice>
            ) : props.linkedAccountsEmptyStateMessage !== null ? (
              <Notice>{props.linkedAccountsEmptyStateMessage}</Notice>
            ) : props.linkedAccountCards.length === 0 ? null : (
              props.linkedAccountCards.map((linkedAccountCard) => (
                <LinkedAccountCard
                  key={linkedAccountCard.providerFamily}
                  linkedAccountActionPending={props.linkedAccountActionPending}
                  linkedAccountCard={linkedAccountCard}
                  onLinkLinkedAccount={props.onLinkLinkedAccount}
                  onUnlinkLinkedAccount={props.onUnlinkLinkedAccount}
                  onUpdateLinkedAccountPreferredEmail={props.onUpdateLinkedAccountPreferredEmail}
                />
              ))
            )}

            {props.linkedAccountErrorMessage === null ? null : (
              <Notice variant="alert">{props.linkedAccountErrorMessage}</Notice>
            )}
          </div>
        </FormPageSection>
      ) : null}
    </FormPageStack>
  );
}

function LinkedAccountCard(input: {
  linkedAccountActionPending: boolean;
  linkedAccountCard: LinkedAccountCardViewModel;
  onLinkLinkedAccount: (providerFamily: string) => Promise<void>;
  onUnlinkLinkedAccount: (providerFamily: string) => Promise<void>;
  onUpdateLinkedAccountPreferredEmail: (
    providerFamily: string,
    preferredEmail: string,
  ) => Promise<void>;
}): React.JSX.Element {
  const emailPreference = input.linkedAccountCard.emailPreference;
  const [selectedEmail, setSelectedEmail] = useState(emailPreference?.selectedEmail ?? "");
  const selectedOptionLabel = emailPreference?.options.find(
    (option) => option.value === selectedEmail,
  )?.label;

  useEffect(() => {
    setSelectedEmail(emailPreference?.selectedEmail ?? "");
  }, [emailPreference?.selectedEmail, input.linkedAccountCard.providerFamily]);

  return (
    <div className="rounded border bg-background p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <img
            alt={`${input.linkedAccountCard.displayName} logo`}
            className="h-10 w-10 rounded-md border bg-background p-1.5"
            src={resolveIntegrationLogoPath({ logoKey: input.linkedAccountCard.logoKey })}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{input.linkedAccountCard.displayName}</h3>
              <LinkedAccountStatusBadge tone={input.linkedAccountCard.statusTone}>
                {input.linkedAccountCard.statusLabel}
              </LinkedAccountStatusBadge>
            </div>
            <p className="text-sm">{input.linkedAccountCard.accountLabel}</p>
            {input.linkedAccountCard.linkedAtLabel === null ? null : (
              <p className="text-xs text-muted-foreground">
                {input.linkedAccountCard.linkedAtLabel}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {input.linkedAccountCard.primaryActionLabel === null ? null : (
            <Button
              disabled={input.linkedAccountActionPending}
              onClick={() => {
                void input.onLinkLinkedAccount(input.linkedAccountCard.providerFamily);
              }}
              type="button"
            >
              {input.linkedAccountActionPending
                ? "Working..."
                : input.linkedAccountCard.primaryActionLabel}
            </Button>
          )}
          {input.linkedAccountCard.secondaryActionLabel === null ? null : (
            <Button
              disabled={input.linkedAccountActionPending}
              onClick={() => {
                void input.onUnlinkLinkedAccount(input.linkedAccountCard.providerFamily);
              }}
              type="button"
              variant="outline"
            >
              {input.linkedAccountActionPending
                ? "Working..."
                : input.linkedAccountCard.secondaryActionLabel}
            </Button>
          )}
        </div>
      </div>

      {emailPreference === null ? null : (
        <div className="mt-4">
          <Field contentWidth="fill" orientation="horizontal">
            <FieldHeader>
              <FieldLabel>Commit email</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select
                  onValueChange={(nextValue) => {
                    setSelectedEmail(nextValue ?? "");
                  }}
                  value={selectedEmail}
                >
                  <SelectTrigger
                    className="w-full"
                    id={`linked-account-preferred-email-${input.linkedAccountCard.providerFamily}`}
                    style={{ width: "100%", maxWidth: "32rem" }}
                  >
                    <SelectValue placeholder="Select commit email">
                      {selectedOptionLabel}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {emailPreference.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={
                    input.linkedAccountActionPending ||
                    selectedEmail.length === 0 ||
                    selectedEmail === emailPreference.selectedEmail
                  }
                  onClick={() => {
                    void input.onUpdateLinkedAccountPreferredEmail(
                      input.linkedAccountCard.providerFamily,
                      selectedEmail,
                    );
                  }}
                  type="button"
                  variant="outline"
                >
                  {input.linkedAccountActionPending ? "Working..." : "Save"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{emailPreference.helperText}</p>
            </FieldContent>
          </Field>
        </div>
      )}

      {input.linkedAccountCard.helperMessage === null ? null : (
        <p className="mt-3 text-sm text-muted-foreground">
          {input.linkedAccountCard.helperMessage}
        </p>
      )}
    </div>
  );
}

function shouldRenderLinkedAccountsSection(
  props: Pick<
    ProfileSettingsPageViewProps,
    | "linkedAccountCallbackNotice"
    | "linkedAccountCards"
    | "linkedAccountErrorMessage"
    | "linkedAccountsEmptyStateMessage"
    | "linkedAccountsLoading"
    | "linkedAccountsLoadErrorMessage"
  >,
): boolean {
  return (
    props.linkedAccountsLoading ||
    props.linkedAccountsLoadErrorMessage !== null ||
    props.linkedAccountsEmptyStateMessage !== null ||
    props.linkedAccountCards.length > 0 ||
    props.linkedAccountCallbackNotice !== null ||
    props.linkedAccountErrorMessage !== null
  );
}

function LinkedAccountStatusBadge(input: {
  children: React.ReactNode;
  tone: "active" | "warning" | "disabled";
}): React.JSX.Element {
  const className =
    input.tone === "active"
      ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-700"
      : input.tone === "warning"
        ? "border-amber-600/30 bg-amber-600/10 text-amber-700"
        : "border-slate-600/20 bg-slate-600/5 text-slate-700";

  return (
    <Badge className={className} variant="outline">
      {input.children}
    </Badge>
  );
}
