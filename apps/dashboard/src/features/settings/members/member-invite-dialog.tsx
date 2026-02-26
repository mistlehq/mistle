import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";

import type { InviteMemberResponse, OrganizationRole } from "./members-api.js";

import { MemberInviteChipInput } from "./member-invite-chip-input.js";
import { MemberInviteResultsView } from "./member-invite-results-view.js";
import { formatRoleLabel, parseRoleSelectValue } from "./members-formatters.js";
import {
  canRetryFailedInvites,
  canSendInvites,
  useMemberInviteForm,
} from "./use-member-invite-form.js";

export { canRetryFailedInvites, canSendInvites } from "./use-member-invite-form.js";

export function MemberInviteDialog(input: {
  open: boolean;
  canExecute: boolean;
  organizationId: string;
  assignableRoles: OrganizationRole[];
  inviteMemberRequest: (request: {
    organizationId: string;
    email: string;
    role: OrganizationRole;
  }) => Promise<InviteMemberResponse>;
  onCompleted: () => Promise<void>;
  onOpenChange: (nextOpen: boolean) => void;
}): React.JSX.Element {
  const form = useMemberInviteForm({
    open: input.open,
    canExecute: input.canExecute,
    assignableRoles: input.assignableRoles,
    organizationId: input.organizationId,
    inviteMemberRequest: input.inviteMemberRequest,
  });

  async function handleDone(): Promise<void> {
    await input.onCompleted();
    input.onOpenChange(false);
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (form.isSubmitting) {
          return;
        }
        input.onOpenChange(nextOpen);
      }}
      open={input.open}
    >
      <DialogContent showCloseButton={!form.isSubmitting}>
        <DialogHeader className="pb-4 border-b">
          <DialogTitle className="text-lg leading-tight font-semibold">Invite members</DialogTitle>
        </DialogHeader>

        {form.phase === "compose" ? (
          <>
            <Field>
              <FieldLabel>Emails</FieldLabel>
              <FieldContent>
                <MemberInviteChipInput
                  chips={form.chips}
                  disabled={form.isSubmitting || !input.canExecute}
                  onValueChange={form.setDraftEmailValue}
                  onAddTokens={form.addTokens}
                  onRemoveChip={form.removeChip}
                  value={form.draftEmailValue}
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>Role</FieldLabel>
              <FieldContent>
                <Select
                  onValueChange={(nextValue) => {
                    const parsedRole = parseRoleSelectValue(nextValue);
                    form.setSelectedRole(parsedRole);
                    form.clearRoleError();
                  }}
                  value={form.selectedRole ?? undefined}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a role">
                      {form.selectedRole === null ? undefined : formatRoleLabel(form.selectedRole)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {input.assignableRoles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {formatRoleLabel(role)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
              {form.roleError ? <FieldError errors={[{ message: form.roleError }]} /> : null}
            </Field>
          </>
        ) : (
          <MemberInviteResultsView chips={form.chips} />
        )}

        {!input.canExecute ? (
          <Alert variant="destructive">
            <AlertTitle>Invites are disabled</AlertTitle>
            <AlertDescription>
              You do not have permission to invite members in this organization.
            </AlertDescription>
          </Alert>
        ) : null}

        {form.dialogError ? (
          <Alert variant="destructive">
            <AlertTitle>Request failed</AlertTitle>
            <AlertDescription>{form.dialogError}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          {form.phase === "results" ? (
            <>
              {form.outcomeSummary.failed > 0 ? (
                <Button
                  disabled={
                    !canRetryFailedInvites({
                      isSubmitting: form.isSubmitting,
                      canExecute: input.canExecute,
                      failedChipCount: form.failedChipIds.length,
                    })
                  }
                  onClick={() => void form.retryFailedInvites()}
                  type="button"
                  variant="outline"
                >
                  Retry failed
                </Button>
              ) : null}
              <Button disabled={form.isSubmitting} onClick={() => void handleDone()} type="button">
                Done
              </Button>
            </>
          ) : (
            <>
              <Button
                disabled={form.isSubmitting}
                onClick={() => input.onOpenChange(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={
                  !canSendInvites({
                    isSubmitting: form.isSubmitting,
                    canExecute: input.canExecute,
                    selectedRole: form.selectedRole,
                    sendableInviteCount:
                      form.validPendingChipIds.length + form.sendableDraftTokenCount,
                  })
                }
                onClick={() => void form.submitValidPendingInvites()}
                type="button"
              >
                Send invites
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
