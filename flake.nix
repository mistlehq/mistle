{
  description = "Mistle local development shell (Nix-first)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        nodejs = if pkgs ? nodejs_25 then pkgs.nodejs_25 else pkgs.nodejs;
        docsNodejs = if pkgs ? nodejs_22 then pkgs.nodejs_22 else pkgs.nodejs;
        codexVersion = "0.135.0";
        opencodeVersion = "1.15.12";
        codexReleaseAsset =
          {
            x86_64-linux = {
              fileName = "codex-x86_64-unknown-linux-musl.tar.gz";
              binaryName = "codex-x86_64-unknown-linux-musl";
              hash = "sha256-oV59rWV9pKDhIO7eKVVv7m1Q6MkZdZzC7Lo8mQmTY+I=";
            };
            aarch64-linux = {
              fileName = "codex-aarch64-unknown-linux-musl.tar.gz";
              binaryName = "codex-aarch64-unknown-linux-musl";
              hash = "sha256-VovOHVk+8l/99VSTaahgYIVlIpRkalxJYVR6iU6i920=";
            };
            x86_64-darwin = {
              fileName = "codex-x86_64-apple-darwin.tar.gz";
              binaryName = "codex-x86_64-apple-darwin";
              hash = "sha256-fiavDEUU7mXG+DdJhLQrb+P3z2lzK2IwX4Xywny9xuU=";
            };
            aarch64-darwin = {
              fileName = "codex-aarch64-apple-darwin.tar.gz";
              binaryName = "codex-aarch64-apple-darwin";
              hash = "sha256-v+5SmujraFIUyKq2YdjWtDmzI2XSy/nVBSHNaZbUszw=";
            };
          }
          .${system}
          or (throw "Unsupported system for pinned Codex CLI: ${system}");
        opencodeReleaseAsset =
          {
            x86_64-linux = {
              fileName = "opencode-linux-x64-baseline.tar.gz";
              hash = "sha256-K1ac3xxWMYXrCB8VTXiQKkhSO+n4kBYl0eDX9nrjXBA=";
              unpackPhase = ''tar -xzf "$src"'';
            };
            aarch64-linux = {
              fileName = "opencode-linux-arm64.tar.gz";
              hash = "sha256-7VGBuB6Xj6An2fR81n+Prr7GNCI9f4JKoiYSYYjMvuU=";
              unpackPhase = ''tar -xzf "$src"'';
            };
            x86_64-darwin = {
              fileName = "opencode-darwin-x64-baseline.zip";
              hash = "sha256-r43fdDv4D4KDGCmFTJ2II25IWKzqNWaSViVcd2C3h9c=";
              unpackPhase = ''unzip "$src"'';
            };
            aarch64-darwin = {
              fileName = "opencode-darwin-arm64.zip";
              hash = "sha256-1lTw4/Ur26VgsarAIeH+x+9FbSGw8Cw7qCAoQ+c9vUU=";
              unpackPhase = ''unzip "$src"'';
            };
          }
          .${system}
          or (throw "Unsupported system for pinned OpenCode CLI: ${system}");
        codexPinned = pkgs.stdenvNoCC.mkDerivation {
          pname = "codex";
          version = codexVersion;

          src = pkgs.fetchurl {
            url =
              "https://github.com/openai/codex/releases/download/rust-v${codexVersion}/${codexReleaseAsset.fileName}";
            hash = codexReleaseAsset.hash;
          };

          dontConfigure = true;
          dontBuild = true;

          unpackPhase = ''
            tar -xzf "$src"
          '';

          installPhase = ''
            mkdir -p "$out/bin"
            install -m755 "${codexReleaseAsset.binaryName}" "$out/bin/codex"
          '';
        };
        opencodePinned = pkgs.stdenvNoCC.mkDerivation {
          pname = "opencode";
          version = opencodeVersion;

          src = pkgs.fetchurl {
            url =
              "https://github.com/anomalyco/opencode/releases/download/v${opencodeVersion}/${opencodeReleaseAsset.fileName}";
            hash = opencodeReleaseAsset.hash;
          };

          nativeBuildInputs = [ pkgs.unzip ];
          dontConfigure = true;
          dontBuild = true;

          unpackPhase = opencodeReleaseAsset.unpackPhase;

          installPhase = ''
            mkdir -p "$out/bin"
            install -m755 opencode "$out/bin/opencode"
          '';
        };
        commonPackages = [
          pkgs.typos
          pkgs.llvm
          pkgs.pnpm
          pkgs.rustc
          pkgs.cargo
          pkgs.rustfmt
          pkgs.clippy
          pkgs.rust-analyzer
          pkgs.ripgrep
          pkgs.cloudflared
          pkgs.docker
          pkgs.git
          pkgs.git-cliff
          pkgs.jq
          pkgs.ripgrep
        ];
        commonShellHook = ''
          export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
          export RUST_SRC_PATH=${pkgs.rustPlatform.rustLibSrc}
        '';
      in
      {
        packages.codex = codexPinned;
        packages.opencode = opencodePinned;

        devShells.default = pkgs.mkShell {
          packages = [nodejs codexPinned opencodePinned] ++ commonPackages;
          shellHook = ''
            ${commonShellHook}
            export PATH=${codexPinned}/bin:$PATH
            export PATH=${opencodePinned}/bin:$PATH
          '';
        };

        devShells.docs = pkgs.mkShell {
          packages = [docsNodejs] ++ commonPackages;
          shellHook = commonShellHook;
        };
      });
}
