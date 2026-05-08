# syntax=docker/dockerfile:1.7

FROM node:25-alpine3.22 AS base

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /app

RUN npm install --global pnpm@10.30.2

FROM base AS workspace-deps

COPY . .
RUN pnpm install --frozen-lockfile

FROM workspace-deps AS control-plane-api-build
RUN pnpm --filter @mistle/control-plane-api... build

FROM workspace-deps AS dashboard-build
ARG MISTLE_CONFIG_PATH=/app/config/config.sample.toml
ENV MISTLE_CONFIG_PATH=${MISTLE_CONFIG_PATH}
RUN pnpm --filter @mistle/dashboard... build

FROM workspace-deps AS control-plane-worker-build
RUN pnpm --filter @mistle/control-plane-worker... build

FROM workspace-deps AS data-plane-api-build
RUN pnpm --filter @mistle/data-plane-api... build

FROM workspace-deps AS data-plane-worker-build
RUN pnpm --filter @mistle/data-plane-worker... build

FROM workspace-deps AS data-plane-gateway-build
RUN pnpm --filter @mistle/data-plane-gateway... build

FROM alpine:3.22 AS commit-sign-build

WORKDIR /build/packages/commit-sign

RUN apk add --no-cache cargo rust build-base musl-dev

COPY packages/commit-sign/Cargo.toml packages/commit-sign/Cargo.lock ./
COPY packages/commit-sign/src ./src

RUN cargo build --locked --release --bin commit-sign

FROM base AS control-plane-worker-runtime

COPY --from=control-plane-worker-build /app /app
COPY docker/apps/control-plane-worker/entrypoint.sh /usr/local/bin/mistle-control-plane-worker-entrypoint

RUN mkdir -p /app/node_modules/@mistle && \
  ln -s ../../apps/control-plane-worker /app/node_modules/@mistle/control-plane-worker && \
  chmod +x /usr/local/bin/mistle-control-plane-worker-entrypoint

EXPOSE 5101

ENTRYPOINT ["/usr/local/bin/mistle-control-plane-worker-entrypoint"]

FROM nginx:1.29-alpine AS dashboard-runtime

COPY --from=dashboard-build /app/apps/dashboard/dist /usr/share/nginx/html
COPY docker/apps/dashboard/entrypoint.sh /usr/local/bin/mistle-dashboard-entrypoint
COPY docker/apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf

RUN chmod +x /usr/local/bin/mistle-dashboard-entrypoint

EXPOSE 80

ENTRYPOINT ["/usr/local/bin/mistle-dashboard-entrypoint"]

FROM base AS data-plane-api-runtime

COPY --from=data-plane-api-build /app /app
COPY docker/apps/data-plane-api/entrypoint.sh /usr/local/bin/mistle-data-plane-api-entrypoint

RUN mkdir -p /app/node_modules/@mistle && \
  ln -s ../../apps/data-plane-api /app/node_modules/@mistle/data-plane-api && \
  chmod +x /usr/local/bin/mistle-data-plane-api-entrypoint

EXPOSE 5200

ENTRYPOINT ["/usr/local/bin/mistle-data-plane-api-entrypoint"]

FROM base AS data-plane-worker-runtime

COPY --from=data-plane-worker-build /app /app
COPY docker/apps/data-plane-worker/entrypoint.sh /usr/local/bin/mistle-data-plane-worker-entrypoint

RUN mkdir -p /app/node_modules/@mistle && \
  ln -s ../../apps/data-plane-worker /app/node_modules/@mistle/data-plane-worker && \
  chmod +x /usr/local/bin/mistle-data-plane-worker-entrypoint

EXPOSE 5201

ENTRYPOINT ["/usr/local/bin/mistle-data-plane-worker-entrypoint"]

FROM base AS data-plane-gateway-runtime

COPY --from=data-plane-gateway-build /app /app
COPY docker/apps/data-plane-gateway/entrypoint.sh /usr/local/bin/mistle-data-plane-gateway-entrypoint

RUN mkdir -p /app/node_modules/@mistle && \
  ln -s ../../apps/data-plane-gateway /app/node_modules/@mistle/data-plane-gateway && \
  chmod +x /usr/local/bin/mistle-data-plane-gateway-entrypoint

EXPOSE 5202

ENTRYPOINT ["/usr/local/bin/mistle-data-plane-gateway-entrypoint"]

FROM base AS control-plane-api-runtime

COPY --from=control-plane-api-build /app /app
COPY --from=commit-sign-build /build/packages/commit-sign/target/release/commit-sign /usr/local/bin/commit-sign
COPY docker/apps/control-plane-api/entrypoint.sh /usr/local/bin/mistle-control-plane-api-entrypoint

RUN mkdir -p /app/node_modules/@mistle && \
  ln -s ../../apps/control-plane-api /app/node_modules/@mistle/control-plane-api && \
  chmod +x /usr/local/bin/commit-sign /usr/local/bin/mistle-control-plane-api-entrypoint

EXPOSE 5100

ENTRYPOINT ["/usr/local/bin/mistle-control-plane-api-entrypoint"]
