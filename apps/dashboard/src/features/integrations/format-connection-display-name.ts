type ConnectionDisplayNameInput = {
  connection: {
    id: string;
    targetKey: string;
  };
  targets: ReadonlyArray<{
    targetKey: string;
    displayName: string;
  }>;
};

export function formatConnectionDisplayName(input: ConnectionDisplayNameInput): string {
  const target = input.targets.find(
    (candidate) => candidate.targetKey === input.connection.targetKey,
  );
  if (target === undefined) {
    throw new Error(
      `Integration target metadata is missing for connection '${input.connection.id}' with target key '${input.connection.targetKey}'.`,
    );
  }

  return target.displayName;
}
