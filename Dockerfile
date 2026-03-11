# syntax=docker/dockerfile:1.7

ARG MISTLE_CONFIG_FILE=config.production.toml

FROM node:22-alpine AS base

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

FROM base AS workspace-deps

COPY . .
RUN pnpm install --frozen-lockfile

FROM workspace-deps AS control-plane-build
RUN pnpm --filter @mistle/control-plane... build

FROM workspace-deps AS data-plane-build
RUN pnpm --filter @mistle/data-plane... build

FROM workspace-deps AS data-plane-gateway-build
RUN pnpm --filter @mistle/data-plane-gateway... build

FROM workspace-deps AS tokenizer-proxy-build
RUN pnpm --filter @mistle/tokenizer-proxy... build

FROM base AS control-plane-worker-runtime

COPY --from=control-plane-build /workspace /workspace
COPY docker/apps/control-plane-worker/entrypoint.sh /usr/local/bin/mistle-control-plane-worker-entrypoint

RUN chmod +x /usr/local/bin/mistle-control-plane-worker-entrypoint

ARG MISTLE_CONFIG_FILE
ENV MISTLE_CONFIG_PATH=/workspace/config/${MISTLE_CONFIG_FILE}
EXPOSE 5101

ENTRYPOINT ["/usr/local/bin/mistle-control-plane-worker-entrypoint"]

FROM base AS data-plane-api-runtime

COPY --from=data-plane-build /workspace /workspace
COPY docker/apps/data-plane-api/entrypoint.sh /usr/local/bin/mistle-data-plane-api-entrypoint

RUN chmod +x /usr/local/bin/mistle-data-plane-api-entrypoint

ARG MISTLE_CONFIG_FILE
ENV MISTLE_CONFIG_PATH=/workspace/config/${MISTLE_CONFIG_FILE}
EXPOSE 5200

ENTRYPOINT ["/usr/local/bin/mistle-data-plane-api-entrypoint"]

FROM base AS data-plane-worker-runtime

COPY --from=data-plane-build /workspace /workspace
COPY docker/apps/data-plane-worker/entrypoint.sh /usr/local/bin/mistle-data-plane-worker-entrypoint

RUN chmod +x /usr/local/bin/mistle-data-plane-worker-entrypoint

ARG MISTLE_CONFIG_FILE
ENV MISTLE_CONFIG_PATH=/workspace/config/${MISTLE_CONFIG_FILE}
EXPOSE 5201

ENTRYPOINT ["/usr/local/bin/mistle-data-plane-worker-entrypoint"]

FROM base AS data-plane-gateway-runtime

COPY --from=data-plane-gateway-build /workspace /workspace
COPY docker/apps/data-plane-gateway/entrypoint.sh /usr/local/bin/mistle-data-plane-gateway-entrypoint

RUN chmod +x /usr/local/bin/mistle-data-plane-gateway-entrypoint

ARG MISTLE_CONFIG_FILE
ENV MISTLE_CONFIG_PATH=/workspace/config/${MISTLE_CONFIG_FILE}
EXPOSE 5202

ENTRYPOINT ["/usr/local/bin/mistle-data-plane-gateway-entrypoint"]

FROM base AS tokenizer-proxy-runtime

COPY --from=tokenizer-proxy-build /workspace /workspace
COPY docker/apps/tokenizer-proxy/entrypoint.sh /usr/local/bin/mistle-tokenizer-proxy-entrypoint

RUN chmod +x /usr/local/bin/mistle-tokenizer-proxy-entrypoint

ARG MISTLE_CONFIG_FILE
ENV MISTLE_CONFIG_PATH=/workspace/config/${MISTLE_CONFIG_FILE}
EXPOSE 5205

ENTRYPOINT ["/usr/local/bin/mistle-tokenizer-proxy-entrypoint"]

FROM base AS control-plane-api-runtime

COPY --from=control-plane-build /workspace /workspace
COPY docker/apps/control-plane-api/entrypoint.sh /usr/local/bin/mistle-control-plane-api-entrypoint

RUN chmod +x /usr/local/bin/mistle-control-plane-api-entrypoint

ARG MISTLE_CONFIG_FILE
ENV MISTLE_CONFIG_PATH=/workspace/config/${MISTLE_CONFIG_FILE}
EXPOSE 5100

ENTRYPOINT ["/usr/local/bin/mistle-control-plane-api-entrypoint"]
