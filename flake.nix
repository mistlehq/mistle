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
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            nodejs
            pkgs.codespell
            pkgs.llvm
            pkgs.pnpm
            pkgs.rustc
            pkgs.cargo
            pkgs.rustfmt
            pkgs.clippy
            pkgs.cloudflared
            pkgs.docker
            pkgs.git
            pkgs.git-cliff
            pkgs.jq
          ];

          shellHook = ''
            export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
          '';
        };
      });
}
