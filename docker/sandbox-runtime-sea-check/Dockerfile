FROM node:25-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
  RUSTUP_HOME=/root/.rustup \
  CARGO_HOME=/root/.cargo \
  PATH=/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  RUSTUP_INIT_SKIP_PATH_CHECK=yes

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    g++ \
    make \
    pkg-config \
    python3 \
  && rm -rf /var/lib/apt/lists/*

RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --default-toolchain stable
RUN npm install -g pnpm@10.30.2

WORKDIR /work
