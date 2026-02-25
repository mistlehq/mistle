import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { BetterAuthOptions } from "better-auth";

type SessionCreateBeforeHook = NonNullable<
  NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["session"]>["create"]
>["before"];

type SessionCreateBeforeInput = Parameters<NonNullable<SessionCreateBeforeHook>>[0];
type SessionCreateBeforeResult = Exclude<
  Awaited<ReturnType<NonNullable<SessionCreateBeforeHook>>>,
  boolean | void
>;

type ApplyActiveOrganizationToSessionInput = {
  db: ControlPlaneDatabase;
  session: SessionCreateBeforeInput;
};

export async function applyActiveOrganizationToSession(
  input: ApplyActiveOrganizationToSessionInput,
): Promise<SessionCreateBeforeResult | undefined> {
  const { db, session } = input;

  if (typeof session.activeOrganizationId === "string" && session.activeOrganizationId.length > 0) {
    return;
  }

  const membership = await db.query.members.findFirst({
    columns: {
      organizationId: true,
    },
    where: (members, { eq }) => eq(members.userId, session.userId),
    orderBy: (members, { asc }) => [asc(members.createdAt)],
  });

  if (membership === undefined) {
    return;
  }

  return {
    data: {
      ...session,
      activeOrganizationId: membership.organizationId,
    },
  };
}
