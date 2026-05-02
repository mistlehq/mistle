# syntax=docker/dockerfile:1.7

FROM debian:bookworm-slim AS sandbox-base-common

ARG MISE_VERSION=v2026.4.28

ENV DEBIAN_FRONTEND=noninteractive \
  PATH="/opt/mistle/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    coreutils \
    curl \
    findutils \
    gawk \
    git \
    grep \
    iproute2 \
    jq \
    less \
    lsof \
    ripgrep \
    sed \
    tar \
    tini \
    unzip \
  && rm -rf /var/lib/apt/lists/*

# Login shells source /etc/profile, which resets PATH on Debian. Re-add the
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

RUN cargo build --locked --release --bin sandboxd

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
  && curl -fsSL https://archil.com/install | ARCHIL_SKIP_IAM_CHECK=1 sh \
  && ln -sf /usr/bin/archil /opt/mistle/bin/archil \
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

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/mistle/bin/sandboxd"]

FROM sandbox-base AS sandbox-base-system-tests

COPY --from=sandboxd-system-tests-build /app/packages/sandboxd/target/debug/sandboxd /opt/mistle/bin/sandboxd

RUN chmod +x /opt/mistle/bin/sandboxd \
  && ln -sf /opt/mistle/bin/sandboxd /opt/mistle/bin/mistle-ssh-sign \
  && ln -sf /opt/mistle/bin/sandboxd /usr/local/bin/sandboxd \
  && ln -sf /opt/mistle/bin/mistle-ssh-sign /usr/local/bin/mistle-ssh-sign

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/mistle/bin/sandboxd"]
