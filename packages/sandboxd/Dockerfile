# syntax=docker/dockerfile:1.7

FROM ubuntu:24.04 AS sandbox-base-common

ARG MISE_VERSION=v2026.4.28

ENV DEBIAN_FRONTEND=noninteractive \
  container=docker \
  HOME=/root \
  PATH="/opt/mistle/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    coreutils \
    curl \
    dbus \
    fd-find \
    findutils \
    gawk \
    git \
    grep \
    iproute2 \
    jq \
    kmod \
    less \
    lsof \
    nftables \
    ripgrep \
    sed \
    systemd \
    systemd-sysv \
    tar \
    unzip \
  && rm -rf /var/lib/apt/lists/*

# Login shells source /etc/profile, which can reset PATH. Re-add the
# sandbox tool location so runtime artifacts remain discoverable.
RUN cat > /etc/profile.d/mistle-path.sh <<'EOF'
for p in /opt/mistle/bin; do
  case ":$PATH:" in
    *":$p:"*) ;;
    *) PATH="$p:$PATH" ;;
  esac
done
export PATH
EOF

RUN mkdir -p /opt/mistle/bin

COPY packages/sandboxd/scripts/cmddir /opt/mistle/bin/cmddir
COPY packages/sandboxd/systemd/sandboxd.service /etc/systemd/system/sandboxd.service
RUN chmod +x /opt/mistle/bin/cmddir \
  && ln -sf /opt/mistle/bin/cmddir /usr/local/bin/cmddir \
  && mkdir -p /etc/systemd/system/multi-user.target.wants \
  && ln -sf /etc/systemd/system/sandboxd.service /etc/systemd/system/multi-user.target.wants/sandboxd.service

RUN mkdir -p \
    /run/mistle \
    /var/lib/mistle/artifacts \
  && chmod 0700 /run/mistle

RUN curl -fsSL https://mise.run | MISE_VERSION="${MISE_VERSION}" MISE_INSTALL_PATH="/opt/mistle/bin/mise" sh

RUN chmod +x /opt/mistle/bin/mise \
  && ln -sf /opt/mistle/bin/mise /usr/local/bin/mise

WORKDIR /root
USER root

FROM rust:1.95-bookworm AS sandboxd-build

# Build only the standalone sandboxd Rust crate. The sandbox base image copies
# this binary directly and does not need the rest of the workspace build.

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libssl-dev \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/packages/sandboxd

COPY packages/sandboxd /app/packages/sandboxd

RUN cargo build --locked --release --bin sandboxd \
  && strip target/release/sandboxd

FROM rust:1.95-bookworm AS sandboxd-system-tests-build

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
    file \
    fuse \
    libatomic1 \
    psmisc \
    procps \
    rsync \
    zip \
  && rm -rf /var/lib/apt/lists/*

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

STOPSIGNAL SIGRTMIN+3

ENTRYPOINT ["/sbin/init"]

FROM sandbox-base AS sandbox-base-system-tests

ARG SYSTEM_TEST_VITE_NODE_VERSION=node@24.14.1
ARG SYSTEM_TEST_VITE_PNPM_VERSION=pnpm@10.30.2

COPY --from=sandboxd-system-tests-build /app/packages/sandboxd/target/debug/sandboxd /opt/mistle/bin/sandboxd
COPY tests/system/fixtures/vite-dev-server /opt/mistle/system-test-fixtures/vite-dev-server

RUN chmod +x /opt/mistle/bin/sandboxd \
  && ln -sf /opt/mistle/bin/sandboxd /opt/mistle/bin/mistle-ssh-sign \
  && ln -sf /opt/mistle/bin/sandboxd /usr/local/bin/sandboxd \
  && ln -sf /opt/mistle/bin/mistle-ssh-sign /usr/local/bin/mistle-ssh-sign

RUN cd /opt/mistle/system-test-fixtures/vite-dev-server \
  && /opt/mistle/bin/mise x -y "${SYSTEM_TEST_VITE_NODE_VERSION}" "${SYSTEM_TEST_VITE_PNPM_VERSION}" -- \
    pnpm install --frozen-lockfile --ignore-workspace

STOPSIGNAL SIGRTMIN+3

ENTRYPOINT ["/sbin/init"]

FROM sandbox-base AS sandbox-designer-base

ARG TARGETARCH
ARG CODEX_CLI_VERSION=0.142.0-alpha.12

RUN case "${TARGETARCH}" in \
      amd64) \
        codex_asset="codex-x86_64-unknown-linux-musl.tar.gz"; \
        codex_binary="codex-x86_64-unknown-linux-musl"; \
        codex_sha256="9514f4e738f099c83a58c5231c4566d42af1d5c597928de11913b983664e3c62"; \
        ;; \
      arm64) \
        codex_asset="codex-aarch64-unknown-linux-musl.tar.gz"; \
        codex_binary="codex-aarch64-unknown-linux-musl"; \
        codex_sha256="73587b5a875d5b29586bce321600038ddf3bcf0c50f055ef209855ef074f8b99"; \
        ;; \
      *) \
        echo "Unsupported Designer Codex CLI architecture: ${TARGETARCH}" >&2; \
        exit 1; \
        ;; \
    esac \
  && curl -fsSL \
    "https://github.com/openai/codex/releases/download/rust-v${CODEX_CLI_VERSION}/${codex_asset}" \
    -o /tmp/codex.tar.gz \
  && echo "${codex_sha256}  /tmp/codex.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/codex.tar.gz -C /tmp \
  && install -m 0755 "/tmp/${codex_binary}" /usr/local/bin/codex \
  && rm -f /tmp/codex.tar.gz "/tmp/${codex_binary}" \
  && codex --version

LABEL org.opencontainers.image.title="Mistle Designer Base"
LABEL org.opencontainers.image.description="Sandbox base image for Mistle Designer sessions"

STOPSIGNAL SIGRTMIN+3

ENTRYPOINT ["/sbin/init"]
