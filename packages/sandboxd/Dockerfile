# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.14.1-bookworm
ARG PYTHON_IMAGE=python:3.14.4-bookworm
ARG DOCKER_IMAGE=docker:29.3.1-dind
ARG NIX_IMAGE=nixos/nix:2.34.6

FROM ${DOCKER_IMAGE} AS docker

FROM ${NODE_IMAGE} AS node

FROM ${PYTHON_IMAGE} AS python

FROM ${NIX_IMAGE} AS nix

FROM debian:bookworm-slim AS sandbox-base-common

ARG MISE_VERSION=v2026.4.19

ENV DEBIAN_FRONTEND=noninteractive \
  PATH="/opt/mistle/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:/root/.nix-profile/bin:/nix/var/nix/profiles/default/bin:/nix/var/nix/profiles/default/sbin"

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

# Login shells source /etc/profile, which resets PATH on Debian. Re-add
# sandbox tool locations so commands like `nix` remain discoverable.
RUN cat > /etc/profile.d/mistle-path.sh <<'EOF'
for p in /opt/mistle/bin /root/.nix-profile/bin /nix/var/nix/profiles/default/bin /nix/var/nix/profiles/default/sbin; do
  case ":$PATH:" in
    *":$p:"*) ;;
    *) PATH="$p:$PATH" ;;
  esac
done
export PATH
EOF

RUN mkdir -p /opt/mistle/bin

COPY packages/sandboxd/scripts/cmddir /opt/mistle/bin/cmddir
RUN chmod +x /opt/mistle/bin/cmddir \
  && ln -sf /opt/mistle/bin/cmddir /usr/local/bin/cmddir

RUN mkdir -p \
    /run/mistle \
    /var/lib/mistle/artifacts \
  && chmod 0700 /run/mistle

RUN curl -fsSL https://mise.run | MISE_VERSION="${MISE_VERSION}" MISE_INSTALL_PATH="/opt/mistle/bin/mise" sh

RUN chmod +x /opt/mistle/bin/mise \
  && ln -sf /opt/mistle/bin/mise /usr/local/bin/mise

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

RUN cargo build --locked --release --bin sandboxd

FROM rust:1.93-bookworm AS sandboxd-system-tests-build

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libssl-dev \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/packages/sandboxd

COPY packages/sandboxd /app/packages/sandboxd

RUN cargo build --locked --bin sandboxd

FROM sandbox-base-common AS sandbox-base-tooling

# The final sandbox image only carries the compiled supervisor binary and the
# shared Linux tooling the sandbox session expects at runtime.

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bat \
    dnsutils \
    fd-find \
    file \
    fuse \
    gdb \
    htop \
    iptables \
    kmod \
    libatomic1 \
    make \
    netcat-openbsd \
    psmisc \
    procps \
    rsync \
    sqlite3 \
    strace \
    tcpdump \
    tmux \
    tree \
    vim \
    zip \
  && curl -fsSL https://archil.com/install | ARCHIL_SKIP_IAM_CHECK=1 sh \
  && ln -sf /usr/bin/archil /opt/mistle/bin/archil \
  && ln -sf /usr/bin/batcat /opt/mistle/bin/bat \
  && ln -sf /usr/bin/fdfind /opt/mistle/bin/fd \
  && rm -rf /var/lib/apt/lists/*

COPY --from=python /usr/local /usr/local

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
  && ln -sf /usr/local/lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack

# Copy the full Docker toolchain from a single upstream distribution so the
# client, daemon, runtime helpers, and CLI plugins stay version-aligned.
COPY --from=docker /usr/local/bin/containerd /usr/local/bin/containerd
COPY --from=docker /usr/local/bin/containerd-shim-runc-v2 /usr/local/bin/containerd-shim-runc-v2
COPY --from=docker /usr/local/bin/ctr /usr/local/bin/ctr
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/bin/docker-compose /usr/local/bin/docker-compose
COPY --from=docker /usr/local/bin/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=docker /usr/local/bin/docker-init /usr/local/bin/docker-init
COPY --from=docker /usr/local/bin/docker-proxy /usr/local/bin/docker-proxy
COPY --from=docker /usr/local/bin/dockerd /usr/local/bin/dockerd
COPY --from=docker /usr/local/bin/dockerd-entrypoint.sh /usr/local/bin/dockerd-entrypoint.sh
COPY --from=docker /usr/local/bin/modprobe /usr/local/bin/modprobe
COPY --from=docker /usr/local/bin/runc /usr/local/bin/runc
COPY --from=docker /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins

# Copy the official Nix layout directly instead of re-running the installer in
# this image. The build users match the upstream image configuration.
RUN mkdir -p /var/empty \
  && groupadd --gid 30000 nixbld \
  && for index in $(seq 1 32); do \
    useradd \
      --uid "$((30000 + index))" \
      --gid 30000 \
      --home-dir /var/empty \
      --shell /usr/sbin/nologin \
      --no-create-home \
      --comment "Nix build user ${index}" \
      "nixbld${index}"; \
  done
COPY --from=nix /nix /nix
COPY --from=nix /root/.nix-profile /root/.nix-profile
COPY --from=nix /etc/nix /etc/nix

FROM sandbox-base-tooling AS sandbox-base

LABEL org.opencontainers.image.title="Mistle Sandbox Base"
LABEL org.opencontainers.image.description="Sandbox base image for Mistle coding agent runtimes"
LABEL org.opencontainers.image.url="https://github.com/mistlehq/mistle"
LABEL org.opencontainers.image.source="https://github.com/mistlehq/mistle"
LABEL org.opencontainers.image.vendor="Mistle"

COPY --from=sandboxd-build /app/packages/sandboxd/target/release/sandboxd /opt/mistle/bin/sandboxd

RUN chmod +x /opt/mistle/bin/sandboxd \
  && ln -sf /opt/mistle/bin/sandboxd /opt/mistle/bin/mistle-ssh-sign \
  && ln -sf /opt/mistle/bin/sandboxd /usr/local/bin/sandboxd \
  && ln -sf /opt/mistle/bin/mistle-ssh-sign /usr/local/bin/mistle-ssh-sign

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/mistle/bin/sandboxd"]

FROM sandbox-base AS sandbox-base-system-tests

COPY --from=sandboxd-system-tests-build /app/packages/sandboxd/target/debug/sandboxd /opt/mistle/bin/sandboxd

RUN chmod +x /opt/mistle/bin/sandboxd \
  && ln -sf /opt/mistle/bin/sandboxd /opt/mistle/bin/mistle-ssh-sign \
  && ln -sf /opt/mistle/bin/sandboxd /usr/local/bin/sandboxd \
  && ln -sf /opt/mistle/bin/mistle-ssh-sign /usr/local/bin/mistle-ssh-sign

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/mistle/bin/sandboxd"]
