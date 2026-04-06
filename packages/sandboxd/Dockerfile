# syntax=docker/dockerfile:1.7

FROM debian:bookworm-slim AS sandbox-base-common

ARG MISE_VERSION=2026.2.20

ENV DEBIAN_FRONTEND=noninteractive \
  PATH="/usr/local/bin:${PATH}"

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

COPY packages/sandboxd/scripts/cmddir /usr/local/bin/cmddir
RUN chmod +x /usr/local/bin/cmddir

RUN mkdir -p \
    /run/mistle \
    /var/lib/mistle/artifacts \
  && chmod 0700 /run/mistle

RUN curl -fsSL https://mise.run | MISE_VERSION="${MISE_VERSION}" MISE_INSTALL_PATH="/usr/local/bin/mise" sh

RUN chmod +x /usr/local/bin/mise

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

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libatomic1 \
    procps \
    strace \
    vim \
  && rm -rf /var/lib/apt/lists/*

COPY --from=sandboxd-build /app/packages/sandboxd/target/debug/sandboxd /usr/local/bin/sandboxd

RUN chmod +x /usr/local/bin/sandboxd

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/sandboxd", "serve"]
