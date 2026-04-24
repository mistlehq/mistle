export const PostgresSqlStateCodes = {
  UNIQUE_VIOLATION: "23505",
} as const;

function getStringProperty(value: unknown, propertyName: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const propertyValue = Reflect.get(value, propertyName);
  return typeof propertyValue === "string" ? propertyValue : undefined;
}

function getPostgresErrorProperty(error: unknown, propertyName: string): string | undefined {
  const directProperty = getStringProperty(error, propertyName);
  if (directProperty !== undefined) {
    return directProperty;
  }

  const nestedCause =
    typeof error === "object" && error !== null ? Reflect.get(error, "cause") : undefined;
  return getStringProperty(nestedCause, propertyName);
}

export function isPostgresConstraintError(
  error: unknown,
  input: {
    code: string;
    constraint: string;
  },
): boolean {
  return (
    getPostgresErrorProperty(error, "code") === input.code &&
    getPostgresErrorProperty(error, "constraint") === input.constraint
  );
}

export function isPostgresUniqueConstraintError(error: unknown, constraintName: string): boolean {
  return isPostgresConstraintError(error, {
    code: PostgresSqlStateCodes.UNIQUE_VIOLATION,
    constraint: constraintName,
  });
}
