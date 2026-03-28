export type WebhookPayloadFilterScalar = string | number | boolean | null;

export type WebhookPayloadFilterPath = ReadonlyArray<string>;

export type WebhookPayloadPathInput = string | ReadonlyArray<string>;

export type WebhookPayloadFilter =
  | {
      op: "and";
      filters: ReadonlyArray<WebhookPayloadFilter>;
    }
  | {
      op: "or";
      filters: ReadonlyArray<WebhookPayloadFilter>;
    }
  | {
      op: "not";
      filter: WebhookPayloadFilter;
    }
  | {
      op: "eq";
      path: WebhookPayloadFilterPath;
      value: WebhookPayloadFilterScalar;
    }
  | {
      op: "neq";
      path: WebhookPayloadFilterPath;
      value: WebhookPayloadFilterScalar;
    }
  | {
      op: "in";
      path: WebhookPayloadFilterPath;
      values: ReadonlyArray<WebhookPayloadFilterScalar>;
    }
  | {
      op: "contains";
      path: WebhookPayloadFilterPath;
      value: string;
    }
  | {
      op: "contains_token";
      path: WebhookPayloadFilterPath;
      value: string;
    }
  | {
      op: "starts_with";
      path: WebhookPayloadFilterPath;
      value: string;
    }
  | {
      op: "ends_with";
      path: WebhookPayloadFilterPath;
      value: string;
    }
  | {
      op: "exists";
      path: WebhookPayloadFilterPath;
    }
  | {
      op: "not_exists";
      path: WebhookPayloadFilterPath;
    };
