import { IntegrationResourceListItem } from "./integration-resource-row.js";
import type {
  IntegrationResourceListItemPreviewState,
  IntegrationResourceListItemResourceSummary,
} from "./integration-resource-row.js";

export type IntegrationResourceListProps = {
  connectionId: string;
  onRefreshResource?: (input: { connectionId: string; kind: string }) => void;
  resourceContentByKey?: ReadonlyMap<string, IntegrationResourceListItemPreviewState>;
  resources: readonly IntegrationResourceListItemResourceSummary[];
};

export function IntegrationResourceList(input: IntegrationResourceListProps): React.JSX.Element {
  return (
    <ul className="rounded border divide-y overflow-hidden" data-slot="integration-resource-list">
      {input.resources.map((resource) => (
        <li key={`${input.connectionId}:${resource.kind}`}>
          <IntegrationResourceListItem
            connectionId={input.connectionId}
            resource={resource}
            resourceItems={
              input.resourceContentByKey?.get(`${input.connectionId}:${resource.kind}`) ?? null
            }
            {...(input.onRefreshResource === undefined
              ? {}
              : { onRefreshResource: input.onRefreshResource })}
          />
        </li>
      ))}
    </ul>
  );
}
