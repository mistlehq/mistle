export type RepeatedHeaderValues = Record<string, string[]>;

export type GatewayEgressHttpRequest = {
  actingUserId?: string;
  authority: string;
  headers: RepeatedHeaderValues;
  method: string;
  path: string;
  query?: string;
  scheme: "http" | "https";
};
