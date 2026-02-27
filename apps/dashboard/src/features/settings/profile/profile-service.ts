import { authClient } from "../../../lib/auth/client.js";
import { executeMembersOperation } from "../members/members-api-errors.js";

export async function updateProfileDisplayName(input: { displayName: string }): Promise<void> {
  return executeMembersOperation("updateProfileDisplayName", async () => {
    await authClient.$fetch("/update-user", {
      method: "POST",
      throw: true,
      body: {
        name: input.displayName,
      },
    });
  });
}
