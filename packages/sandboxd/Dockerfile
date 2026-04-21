# syntax=docker/dockerfile:1.7

FROM debian:bookworm-slim AS sandbox-base-common

ARG MISE_VERSION=2026.2.20
ARG ARCHIL_CLIENT_VERSION=0.8.8-1776208557

ENV DEBIAN_FRONTEND=noninteractive \
  PATH="/opt/mistle/bin:/usr/local/bin:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    iproute2 \
    jq \
    less \
    lsof \
    ripgrep \
    tar \
    tini \
    unzip \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/mistle/bin

COPY packages/sandboxd/scripts/cmddir /opt/mistle/bin/cmddir
RUN chmod +x /opt/mistle/bin/cmddir

RUN mkdir -p \
    /run/mistle \
    /var/lib/mistle/artifacts \
  && chmod 0700 /run/mistle

RUN curl -fsSL https://mise.run | MISE_VERSION="${MISE_VERSION}" MISE_INSTALL_PATH="/opt/mistle/bin/mise" sh

RUN chmod +x /opt/mistle/bin/mise

WORKDIR /root
USER root

FROM rust:1.93-bookworm AS sandboxd-build

# Build only the standalone sandboxd Rust crate. The sandbox base image copies
# this binary directly and does not need the rest of the workspace build.

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libssl-dev \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/packages/sandboxd

COPY packages/sandboxd /app/packages/sandboxd

RUN cargo build --locked --bin sandboxd

FROM sandbox-base-common AS sandbox-base

# The final sandbox image only carries the compiled supervisor binary and the
# shared Linux tooling the sandbox session expects at runtime.

ARG ARCHIL_CLIENT_VERSION

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    fuse \
    libatomic1 \
    procps \
    strace \
    vim \
  && arch="$(dpkg --print-architecture)" \
  && archil_package="/tmp/archil_${ARCHIL_CLIENT_VERSION}_${arch}.deb" \
  && curl -fsSL -o "${archil_package}" "https://s3.amazonaws.com/archil-client/pkg/archil_${ARCHIL_CLIENT_VERSION}_${arch}.deb" \
  && apt-get install -y --no-install-recommends "${archil_package}" \
  && ln -sf /usr/bin/archil /opt/mistle/bin/archil \
  && rm -f "${archil_package}" \
  && rm -rf /var/lib/apt/lists/*

COPY --from=sandboxd-build /app/packages/sandboxd/target/debug/sandboxd /opt/mistle/bin/sandboxd

RUN chmod +x /opt/mistle/bin/sandboxd \
  && ln -sf /opt/mistle/bin/sandboxd /opt/mistle/bin/mistle-ssh-sign

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/mistle/bin/sandboxd"]
