# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

FROM base AS workspace-deps

COPY . .
RUN pnpm install --frozen-lockfile

FROM workspace-deps AS control-plane-api-build
RUN pnpm --filter @mistle/control-plane-api... build

FROM workspace-deps AS control-plane-worker-build
RUN pnpm --filter @mistle/control-plane-worker... build

FROM workspace-deps AS data-plane-api-build
RUN pnpm --filter @mistle/data-plane-api... build

FROM workspace-deps AS data-plane-worker-build
RUN pnpm --filter @mistle/data-plane-worker... build

FROM workspace-deps AS data-plane-gateway-build
RUN pnpm --filter @mistle/data-plane-gateway... build

FROM workspace-deps AS tokenizer-proxy-build
RUN pnpm --filter @mistle/tokenizer-proxy... build

FROM base AS control-plane-worker-runtime

COPY --from=control-plane-worker-build /workspace /workspace
COPY docker/apps/control-plane-worker/entrypoint.sh /usr/local/bin/mistle-control-plane-worker-entrypoint

RUN chmod +x /usr/local/bin/mistle-control-plane-worker-entrypoint

ENV MISTLE_CONFIG_PATH=/workspace/config/config.development.toml
EXPOSE 5101

ENTRYPOINT ["/usr/local/bin/mistle-control-plane-worker-entrypoint"]

FROM base AS data-plane-api-runtime

COPY --from=data-plane-api-build /workspace /workspace
COPY docker/apps/data-plane-api/entrypoint.sh /usr/local/bin/mistle-data-plane-api-entrypoint

RUN chmod +x /usr/local/bin/mistle-data-plane-api-entrypoint

ENV MISTLE_CONFIG_PATH=/workspace/config/config.development.toml
EXPOSE 5200

ENTRYPOINT ["/usr/local/bin/mistle-data-plane-api-entrypoint"]

FROM base AS data-plane-worker-runtime

COPY --from=data-plane-worker-build /workspace /workspace
COPY docker/apps/data-plane-worker/entrypoint.sh /usr/local/bin/mistle-data-plane-worker-entrypoint

RUN chmod +x /usr/local/bin/mistle-data-plane-worker-entrypoint

ENV MISTLE_CONFIG_PATH=/workspace/config/config.development.toml
EXPOSE 5201

ENTRYPOINT ["/usr/local/bin/mistle-data-plane-worker-entrypoint"]

FROM base AS data-plane-gateway-runtime

COPY --from=data-plane-gateway-build /workspace /workspace
COPY docker/apps/data-plane-gateway/entrypoint.sh /usr/local/bin/mistle-data-plane-gateway-entrypoint

RUN chmod +x /usr/local/bin/mistle-data-plane-gateway-entrypoint

ENV MISTLE_CONFIG_PATH=/workspace/config/config.development.toml
EXPOSE 5202

ENTRYPOINT ["/usr/local/bin/mistle-data-plane-gateway-entrypoint"]

FROM base AS tokenizer-proxy-runtime

COPY --from=tokenizer-proxy-build /workspace /workspace
COPY docker/apps/tokenizer-proxy/entrypoint.sh /usr/local/bin/mistle-tokenizer-proxy-entrypoint

RUN chmod +x /usr/local/bin/mistle-tokenizer-proxy-entrypoint

ENV MISTLE_CONFIG_PATH=/workspace/config/config.development.toml
EXPOSE 5205

ENTRYPOINT ["/usr/local/bin/mistle-tokenizer-proxy-entrypoint"]

FROM base AS control-plane-api-runtime

COPY --from=control-plane-api-build /workspace /workspace
COPY docker/apps/control-plane-api/entrypoint.sh /usr/local/bin/mistle-control-plane-api-entrypoint

RUN chmod +x /usr/local/bin/mistle-control-plane-api-entrypoint

ENV MISTLE_CONFIG_PATH=/workspace/config/config.development.toml
EXPOSE 5100

ENTRYPOINT ["/usr/local/bin/mistle-control-plane-api-entrypoint"]
