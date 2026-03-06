type ConnectionDisplayNameInput = {
  connection: {
    id: string;
    displayName: string;
  };
};

export function formatConnectionDisplayName(input: ConnectionDisplayNameInput): string {
  const displayName = input.connection.displayName.trim();
  if (displayName.length === 0) {
    throw new Error(`Integration connection '${input.connection.id}' is missing a display name.`);
  }

  return displayName;
}
