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
            pkgs.pnpm
            pkgs.rustc
            pkgs.cargo
            pkgs.clippy
            pkgs.rustfmt
            pkgs.cloudflared
            pkgs.docker
            pkgs.git
            pkgs.jq
          ];

          shellHook = ''
            export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
            if [ ! -f .env.local ]; then
              echo "Tip: copy sample.env.local to .env.local before running pnpm dev."
            fi
          '';
        };
      });
}
