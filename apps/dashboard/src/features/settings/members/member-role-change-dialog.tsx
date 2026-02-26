import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
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

import type { RoleChangeDialogState } from "./members-capability-policy.js";

import { formatRoleLabel, formatRoleSelectValue } from "./members-formatters.js";

export function MemberRoleChangeDialog(input: {
  roleChangeDialog: RoleChangeDialogState | null;
  open: boolean;
  isUpdatingRole: boolean;
  roleUpdateErrorMessage: string | null;
  onOpenChange: (nextOpen: boolean) => void;
  onRoleSelectValueChange: (nextRoleValue: string | null) => void;
  onCancel: () => void;
  onSaveRole: () => void;
}): React.JSX.Element {
  return (
    <Dialog onOpenChange={input.onOpenChange} open={input.open}>
      {input.roleChangeDialog ? (
        <DialogContent showCloseButton={!input.isUpdatingRole}>
          <DialogHeader>
            <DialogTitle>Change role</DialogTitle>
            <DialogDescription>
              Update role for {input.roleChangeDialog.member.name} (
              {input.roleChangeDialog.member.email}).
            </DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel htmlFor="member-role-select">Role</FieldLabel>
            <FieldContent>
              <Select
                onValueChange={input.onRoleSelectValueChange}
                value={input.roleChangeDialog.selectedRole}
              >
                <SelectTrigger className="w-full" id="member-role-select">
                  <SelectValue placeholder="Select role">
                    {formatRoleSelectValue(input.roleChangeDialog.selectedRole)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {input.roleChangeDialog.allowedRoles.map((role) => (
                    <SelectItem key={role} value={role}>
                      {formatRoleLabel(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldContent>
          </Field>

          {input.roleUpdateErrorMessage ? (
            <FieldError errors={[{ message: input.roleUpdateErrorMessage }]} />
          ) : null}

          <DialogFooter>
            <Button
              disabled={input.isUpdatingRole}
              onClick={input.onCancel}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={input.isUpdatingRole} onClick={input.onSaveRole} type="button">
              Save role
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
