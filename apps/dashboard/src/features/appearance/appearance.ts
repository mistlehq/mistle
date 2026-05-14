export type UserAppearance = "system" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";

export const UserAppearances = {
  SYSTEM: "system",
  LIGHT: "light",
  DARK: "dark",
} satisfies Record<"SYSTEM" | "LIGHT" | "DARK", UserAppearance>;

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record: UnknownRecord = {};
  for (const [key, entryValue] of Object.entries(value)) {
    record[key] = entryValue;
  }

  return record;
}

export function isUserAppearance(value: unknown): value is UserAppearance {
  return (
    value === UserAppearances.SYSTEM ||
    value === UserAppearances.LIGHT ||
    value === UserAppearances.DARK
  );
}

export function readUserAppearanceFromSession(session: unknown): UserAppearance {
  const sessionRecord = toRecord(session);
  const userRecord = sessionRecord === null ? null : toRecord(sessionRecord["user"]);
  const appearance = userRecord === null ? null : userRecord["appearance"];

  if (!isUserAppearance(appearance)) {
    throw new Error("Authenticated user session is missing a valid appearance preference.");
  }

  return appearance;
}

export function resolveAppearance(input: {
  appearance: UserAppearance;
  systemPrefersDark: boolean;
}): ResolvedAppearance {
  if (input.appearance === UserAppearances.SYSTEM) {
    return input.systemPrefersDark ? UserAppearances.DARK : UserAppearances.LIGHT;
  }

  if (input.appearance === UserAppearances.DARK) {
    return UserAppearances.DARK;
  }

  return UserAppearances.LIGHT;
}
