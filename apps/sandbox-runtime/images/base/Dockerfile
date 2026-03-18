FROM golang:1.26-bookworm AS sandbox-runtime-builder

WORKDIR /src/apps/sandbox-runtime
COPY apps/sandbox-runtime/go.mod ./go.mod
COPY apps/sandbox-runtime/go.sum ./go.sum
RUN go mod download
COPY apps/sandbox-runtime/cmd ./cmd
COPY apps/sandbox-runtime/internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/sandboxd ./cmd/sandboxd
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/sandbox-bootstrap ./cmd/sandbox-bootstrap

FROM debian:bookworm-slim AS sandbox-base-common

ARG SANDBOX_USER=sandbox
ARG SANDBOX_UID=10001
ARG SANDBOX_GID=10001
ARG MISE_VERSION=2026.2.20

ENV DEBIAN_FRONTEND=noninteractive \
  SANDBOX_RUNTIME_LISTEN_ADDR=:8090 \
  SANDBOX_USER=${SANDBOX_USER}

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    jq \
    ripgrep \
    tini \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid "${SANDBOX_GID}" "${SANDBOX_USER}" \
  && useradd --uid "${SANDBOX_UID}" --gid "${SANDBOX_GID}" --create-home --shell /bin/sh "${SANDBOX_USER}" \
  && mkdir -p \
    /etc/codex \
    /home/${SANDBOX_USER}/projects \
    /run/mistle \
    /var/lib/mistle/artifacts \
    /var/lib/mistle/bin \
  && chown -R "${SANDBOX_UID}:${SANDBOX_GID}" \
    /etc/codex \
    /home/${SANDBOX_USER} \
    /run/mistle \
    /var/lib/mistle

RUN curl -fsSL https://mise.run | MISE_VERSION="${MISE_VERSION}" MISE_INSTALL_PATH="/usr/local/bin/mise" sh

COPY apps/sandbox-runtime/images/base/mistle-path.sh /etc/profile.d/mistle-path.sh

RUN chmod +x \
  /etc/profile.d/mistle-path.sh \
  /usr/local/bin/mise

ENV PATH="/var/lib/mistle/bin:/home/${SANDBOX_USER}/.local/share/mise/shims:/usr/local/bin:${PATH}"

WORKDIR /home/${SANDBOX_USER}
USER root

FROM sandbox-base-common AS sandbox-base-prod

COPY --from=sandbox-runtime-builder /out/sandboxd /usr/local/bin/sandboxd
COPY --from=sandbox-runtime-builder /out/sandbox-bootstrap /usr/local/bin/sandbox-bootstrap

RUN chmod +x \
  /usr/local/bin/sandbox-bootstrap \
  /usr/local/bin/sandboxd

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/sandbox-bootstrap"]

FROM sandbox-base-prod AS sandbox-base-dev

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    procps \
    strace \
    vim \
  && rm -rf /var/lib/apt/lists/*

FROM sandbox-base-common AS sandbox-base-node-prod

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libatomic1 \
  && rm -rf /var/lib/apt/lists/*

COPY apps/sandbox-runtime-node/dist-sea/ /usr/local/bin/

RUN chmod +x \
  /usr/local/bin/sandbox-bootstrap-node \
  /usr/local/bin/sandboxd-node

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/sandbox-bootstrap-node"]

FROM sandbox-base-node-prod AS sandbox-base-node-dev

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    procps \
    strace \
    vim \
  && rm -rf /var/lib/apt/lists/*
