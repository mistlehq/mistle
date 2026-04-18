import {
  Badge,
  Button,
  Input,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Notice,
} from "@mistle/ui";

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
  linkedAccountCard: LinkedAccountCardViewModel | null;
  linkedAccountErrorMessage: string | null;
  linkedAccountsEmptyStateMessage: string | null;
  linkedAccountsLoading: boolean;
  linkedAccountsLoadErrorMessage: string | null;
  onDeleteProfileImage: () => Promise<void>;
  onLinkLinkedAccount: (providerFamily: string) => Promise<void>;
  onSaveChanges: (displayName: string) => Promise<void>;
  onUnlinkLinkedAccount: (providerFamily: string) => Promise<void>;
  onUploadProfileImage: (file: File) => Promise<void>;
  profileImageBusy: boolean;
  profileImageErrorMessage: string | null;
  saving: boolean;
};

export function ProfileSettingsPageView(props: ProfileSettingsPageViewProps): React.JSX.Element {
  const linkedAccountCard = props.linkedAccountCard;

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
            ) : linkedAccountCard === null ? null : (
              <div className="rounded border bg-background p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <img
                      alt={`${linkedAccountCard.displayName} logo`}
                      className="h-10 w-10 rounded-md border bg-background p-1.5"
                      src={resolveIntegrationLogoPath({ logoKey: linkedAccountCard.logoKey })}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">{linkedAccountCard.displayName}</h3>
                        <LinkedAccountStatusBadge tone={linkedAccountCard.statusTone}>
                          {linkedAccountCard.statusLabel}
                        </LinkedAccountStatusBadge>
                      </div>
                      <p className="text-sm">{linkedAccountCard.accountLabel}</p>
                      {linkedAccountCard.linkedAtLabel === null ? null : (
                        <p className="text-xs text-muted-foreground">
                          {linkedAccountCard.linkedAtLabel}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {linkedAccountCard.primaryActionLabel === null ? null : (
                      <Button
                        disabled={props.linkedAccountActionPending}
                        onClick={() => {
                          void props.onLinkLinkedAccount(linkedAccountCard.providerFamily);
                        }}
                        type="button"
                      >
                        {props.linkedAccountActionPending
                          ? "Working..."
                          : linkedAccountCard.primaryActionLabel}
                      </Button>
                    )}
                    {linkedAccountCard.secondaryActionLabel === null ? null : (
                      <Button
                        disabled={props.linkedAccountActionPending}
                        onClick={() => {
                          void props.onUnlinkLinkedAccount(linkedAccountCard.providerFamily);
                        }}
                        type="button"
                        variant="outline"
                      >
                        {props.linkedAccountActionPending
                          ? "Working..."
                          : linkedAccountCard.secondaryActionLabel}
                      </Button>
                    )}
                  </div>
                </div>

                {linkedAccountCard.helperMessage === null ? null : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {linkedAccountCard.helperMessage}
                  </p>
                )}
              </div>
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

function shouldRenderLinkedAccountsSection(
  props: Pick<
    ProfileSettingsPageViewProps,
    | "linkedAccountCallbackNotice"
    | "linkedAccountCard"
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
    props.linkedAccountCard !== null ||
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
