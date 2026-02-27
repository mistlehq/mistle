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
        nodejs = if pkgs ? nodejs_24 then pkgs.nodejs_24 else pkgs.nodejs;
        python = if pkgs ? python313 then pkgs.python313 else pkgs.python3;
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            nodejs
            python
            python.pkgs.pip
            pkgs.pipx
            pkgs.pnpm
            pkgs.go_1_26
            pkgs.cloudflared
            pkgs.docker
            pkgs.git
            pkgs.jq
          ];

          shellHook = ''
            export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
            export PIPX_DEFAULT_PYTHON=${python}/bin/python3
            REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
            export PIPX_HOME="$REPO_ROOT/.pipx/home"
            export PIPX_BIN_DIR="$REPO_ROOT/.pipx/bin"
            mkdir -p "$PIPX_HOME" "$PIPX_BIN_DIR"
            export PATH="$PIPX_BIN_DIR:$PATH"
            if [ ! -f .env.local ]; then
              echo "Tip: copy sample.env.local to .env.local before running pnpm dev."
            fi
          '';
        };
      });
}
