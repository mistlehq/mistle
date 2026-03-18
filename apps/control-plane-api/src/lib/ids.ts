import { typeid } from "typeid-js";

export const ControlPlaneTypeIdPrefixes = {
  ACCOUNT: "acc",
  INVITATION: "inv",
  MEMBER: "mbr",
  ORGANIZATION: "org",
  SESSION: "ses",
  TEAM: "tem",
  TEAM_MEMBER: "tmb",
  USER: "usr",
  VERIFICATION: "vrf",
};

const BetterAuthTypeIdPrefixesByModelName = new Map<string, string>([
  ["account", ControlPlaneTypeIdPrefixes.ACCOUNT],
  ["accounts", ControlPlaneTypeIdPrefixes.ACCOUNT],
  ["invitation", ControlPlaneTypeIdPrefixes.INVITATION],
  ["invitations", ControlPlaneTypeIdPrefixes.INVITATION],
  ["member", ControlPlaneTypeIdPrefixes.MEMBER],
  ["members", ControlPlaneTypeIdPrefixes.MEMBER],
  ["organization", ControlPlaneTypeIdPrefixes.ORGANIZATION],
  ["organizations", ControlPlaneTypeIdPrefixes.ORGANIZATION],
  ["session", ControlPlaneTypeIdPrefixes.SESSION],
  ["sessions", ControlPlaneTypeIdPrefixes.SESSION],
  ["team", ControlPlaneTypeIdPrefixes.TEAM],
  ["teams", ControlPlaneTypeIdPrefixes.TEAM],
  ["teamMember", ControlPlaneTypeIdPrefixes.TEAM_MEMBER],
  ["teamMembers", ControlPlaneTypeIdPrefixes.TEAM_MEMBER],
  ["user", ControlPlaneTypeIdPrefixes.USER],
  ["users", ControlPlaneTypeIdPrefixes.USER],
  ["verification", ControlPlaneTypeIdPrefixes.VERIFICATION],
  ["verifications", ControlPlaneTypeIdPrefixes.VERIFICATION],
]);

export function createControlPlaneTypeId(prefix: string): string {
  return typeid(prefix).toString();
}

export function createBetterAuthControlPlaneTypeId(model: string): string {
  const prefix = BetterAuthTypeIdPrefixesByModelName.get(model);
  if (prefix === undefined) {
    throw new Error(
      `Unsupported Better Auth model '${model}' for control-plane TypeID generation.`,
    );
  }

  return createControlPlaneTypeId(prefix);
}
