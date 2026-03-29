FROM debian:bookworm-slim AS sandbox-base-common

ARG MISE_VERSION=2026.2.20

ENV DEBIAN_FRONTEND=noninteractive \
  PATH="/var/lib/mistle/bin:/usr/local/bin:${PATH}"

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

RUN mkdir -p \
    /etc/codex \
    /home/sandbox/projects \
    /run/mistle \
    /var/lib/mistle/artifacts \
    /var/lib/mistle/bin \
  && chmod 0700 /run/mistle

RUN curl -fsSL https://mise.run | MISE_VERSION="${MISE_VERSION}" MISE_INSTALL_PATH="/usr/local/bin/mise" sh

COPY apps/sandbox-runtime/mistle-path.sh /etc/profile.d/mistle-path.sh

RUN chmod +x \
  /etc/profile.d/mistle-path.sh \
  /usr/local/bin/mise

WORKDIR /home/sandbox
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
