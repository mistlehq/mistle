import type { IntegrationConnection, IntegrationTarget } from "./integrations-service.js";

export type IntegrationCardStatus = "Connected" | "Error" | "Not connected";

export type IntegrationCardViewModel = {
  target: IntegrationTarget;
  displayName: string;
  description: string;
  status: IntegrationCardStatus;
  connections: readonly IntegrationConnection[];
};

export function deriveIntegrationStatus(
  connections: readonly IntegrationConnection[],
): IntegrationCardStatus {
  for (const connection of connections) {
    if (connection.status === "active") {
      return "Connected";
    }
  }

  for (const connection of connections) {
    if (connection.status === "error") {
      return "Error";
    }
  }

  return "Not connected";
}

export function buildIntegrationCards(input: {
  targets: readonly IntegrationTarget[];
  connections: readonly IntegrationConnection[];
}): readonly IntegrationCardViewModel[] {
  const connectionsByTarget = new Map<string, IntegrationConnection[]>();
  for (const connection of input.connections) {
    const current = connectionsByTarget.get(connection.targetKey);
    if (current === undefined) {
      connectionsByTarget.set(connection.targetKey, [connection]);
      continue;
    }
    current.push(connection);
  }

  const cards = input.targets.map((target) => {
    const targetConnections = connectionsByTarget.get(target.targetKey) ?? [];
    connectionsByTarget.delete(target.targetKey);

    return {
      target,
      displayName: target.displayName,
      description: target.description,
      status: deriveIntegrationStatus(targetConnections),
      connections: targetConnections,
    };
  });

  if (connectionsByTarget.size > 0) {
    const missingTargetKeys = Array.from(connectionsByTarget.keys()).join(", ");
    throw new Error(
      `Integration target metadata is missing for connected target keys: ${missingTargetKeys}`,
    );
  }

  return cards.sort((left, right) => left.displayName.localeCompare(right.displayName));
}
