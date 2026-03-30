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
    tini \
    unzip \
  && rm -rf /var/lib/apt/lists/*

# Keep only generic runtime-owned paths in the base image. Agent-specific config
# trees such as /etc/codex are created on demand by runtime-plan file application.
RUN mkdir -p \
    /run/mistle \
    /var/lib/mistle/artifacts \
  && chmod 0700 /run/mistle

RUN curl -fsSL https://mise.run | MISE_VERSION="${MISE_VERSION}" MISE_INSTALL_PATH="/usr/local/bin/mise" sh

RUN chmod +x /usr/local/bin/mise

# The sandbox session is intentionally a conventional root-owned environment: home,
# default cwd, and the integration workspace all resolve to /root.
WORKDIR /root
USER root

FROM sandbox-base-common AS sandbox-base

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libatomic1 \
    procps \
    strace \
    vim \
  && rm -rf /var/lib/apt/lists/*

COPY apps/sandbox-runtime/dist-sea/ /usr/local/bin/

RUN chmod +x \
  /usr/local/bin/sandboxd

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/sandboxd", "serve"]
