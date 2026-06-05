import type { IntegrationEgressRequestMiddleware } from "@mistle/integrations-core";
import { Kind, OperationTypeNode, parse } from "graphql/language";
import type {
  FragmentDefinitionNode,
  OperationDefinitionNode,
  SelectionSetNode,
} from "graphql/language";

import { GitHubRequestMiddlewareIds } from "./egress-request-middleware.js";

type JsonRecord = Record<string, unknown>;

const GitHubSessionLinkLabel = "🔗 View session";
const GitHubGraphqlMarkdownBodyMutations = new Set([
  "addComment",
  "createPullRequest",
  "updatePullRequest",
]);

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMarkdownTargetRequest(input: { method: string; pathname: string }): boolean {
  if (input.method !== "POST") {
    return false;
  }

  return [
    /\/repos\/[^/]+\/[^/]+\/issues$/,
    /\/repos\/[^/]+\/[^/]+\/issues\/[^/]+\/comments$/,
    /\/repos\/[^/]+\/[^/]+\/pulls$/,
    /\/repos\/[^/]+\/[^/]+\/pulls\/[^/]+\/comments$/,
  ].some((pattern) => pattern.test(input.pathname));
}

function isGraphqlRequest(input: { method: string; pathname: string }): boolean {
  if (input.method !== "POST") {
    return false;
  }

  return input.pathname.endsWith("/graphql");
}

function createMarkdownFooter(sessionUrl: string): string {
  return `\n\n---\n[${GitHubSessionLinkLabel}](${sessionUrl})`;
}

function appendFooterToBody(input: { currentBody: string; footer: string }): string {
  if (input.currentBody.includes(input.footer)) {
    return input.currentBody;
  }

  return `${input.currentBody}${input.footer}`;
}

function applyRestMarkdownFooter(input: { parsedBody: JsonRecord; footer: string }): boolean {
  const currentBody = input.parsedBody["body"];
  if (typeof currentBody !== "string") {
    return false;
  }

  input.parsedBody["body"] = appendFooterToBody({
    currentBody,
    footer: input.footer,
  });
  return true;
}

function isGraphqlMarkdownBodyMutation(input: {
  operationName: string | undefined;
  query: string;
}): boolean {
  const document = parseGitHubGraphqlQuery(input.query);
  const operations: OperationDefinitionNode[] = [];
  const fragments = new Map<string, FragmentDefinitionNode>();

  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      operations.push(definition);
    }
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    }
  }

  const operation = selectGraphqlOperation({
    operationName: input.operationName,
    operations,
  });
  if (operation === undefined || operation.operation !== OperationTypeNode.MUTATION) {
    return false;
  }

  return selectionSetContainsMarkdownBodyMutation({
    fragments,
    selectionSet: operation.selectionSet,
    visitedFragmentNames: new Set(),
  });
}

function parseGitHubGraphqlQuery(query: string) {
  try {
    return parse(query, {
      noLocation: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse GitHub GraphQL request query: ${message}`, {
      cause: error,
    });
  }
}

function selectGraphqlOperation(input: {
  operationName: string | undefined;
  operations: ReadonlyArray<OperationDefinitionNode>;
}): OperationDefinitionNode | undefined {
  if (input.operationName !== undefined) {
    return input.operations.find((operation) => operation.name?.value === input.operationName);
  }

  if (input.operations.length !== 1) {
    return undefined;
  }

  return input.operations[0];
}

function selectionSetContainsMarkdownBodyMutation(input: {
  fragments: ReadonlyMap<string, FragmentDefinitionNode>;
  selectionSet: SelectionSetNode;
  visitedFragmentNames: Set<string>;
}): boolean {
  for (const selection of input.selectionSet.selections) {
    if (
      selection.kind === Kind.FIELD &&
      GitHubGraphqlMarkdownBodyMutations.has(selection.name.value)
    ) {
      return true;
    }

    if (
      selection.kind === Kind.INLINE_FRAGMENT &&
      selectionSetContainsMarkdownBodyMutation({
        ...input,
        selectionSet: selection.selectionSet,
      })
    ) {
      return true;
    }

    if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const fragmentName = selection.name.value;
      if (input.visitedFragmentNames.has(fragmentName)) {
        continue;
      }

      const fragment = input.fragments.get(fragmentName);
      if (fragment === undefined) {
        continue;
      }

      input.visitedFragmentNames.add(fragmentName);
      const containsTargetMutation = selectionSetContainsMarkdownBodyMutation({
        ...input,
        selectionSet: fragment.selectionSet,
      });
      input.visitedFragmentNames.delete(fragmentName);

      if (containsTargetMutation) {
        return true;
      }
    }
  }

  return false;
}

function applyGraphqlMarkdownFooter(input: { parsedBody: JsonRecord; footer: string }): boolean {
  const query = input.parsedBody["query"];
  const operationName = input.parsedBody["operationName"];
  if (
    typeof query !== "string" ||
    (operationName !== undefined && typeof operationName !== "string") ||
    !isGraphqlMarkdownBodyMutation({
      operationName,
      query,
    })
  ) {
    return false;
  }

  const variables = input.parsedBody["variables"];
  if (!isJsonRecord(variables)) {
    return false;
  }

  const graphqlInput = variables["input"];
  if (!isJsonRecord(graphqlInput)) {
    return false;
  }

  const currentBody = graphqlInput["body"];
  if (typeof currentBody !== "string") {
    return false;
  }

  graphqlInput["body"] = appendFooterToBody({
    currentBody,
    footer: input.footer,
  });
  return true;
}

export const AppendSessionLinkToGitHubMarkdownRequestMiddleware: IntegrationEgressRequestMiddleware =
  {
    id: GitHubRequestMiddlewareIds.APPEND_SESSION_LINK_TO_MARKDOWN,
    handle({ ctx, request }) {
      if (request.body === undefined) {
        return request;
      }

      const requestShape = {
        method: request.method,
        pathname: request.url.pathname,
      };
      if (!isMarkdownTargetRequest(requestShape) && !isGraphqlRequest(requestShape)) {
        return request;
      }

      const decodedBody = new TextDecoder().decode(request.body);
      const parsedBody: unknown = JSON.parse(decodedBody);
      if (!isJsonRecord(parsedBody)) {
        return request;
      }

      const footer = createMarkdownFooter(ctx.sessionUrl);
      const didMutate = isMarkdownTargetRequest(requestShape)
        ? applyRestMarkdownFooter({
            parsedBody,
            footer,
          })
        : applyGraphqlMarkdownFooter({
            parsedBody,
            footer,
          });
      if (!didMutate) {
        return request;
      }

      request.body = new TextEncoder().encode(JSON.stringify(parsedBody));
      return request;
    },
  };
