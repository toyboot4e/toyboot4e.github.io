{
  description = "A basic flake for my devlog";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        buildCommand = pkgs.writeShellApplication {
          name = "buildCommand";
          runtimeInputs = with pkgs; [
            (emacs.pkgs.withPackages (epkgs: with epkgs; [ seq esxml ]))
            nodePackages.prettier
          ];
          text = ''
            emacs -Q --script "./build.el" -- "--release"
            prettier --print-width 100 --write out/*.html out/diary/*.html
          '';
        };
      in
      {
        apps.build = flake-utils.lib.mkApp {
          drv = buildCommand;
        };
        packages = {
          devlog = pkgs.stdenvNoCC.mkDerivation {
            name = "devlog";
            src = ./.;
            nativeBuildInputs = with pkgs; [
              buildCommand
            ];
            buildPhase = ''
              export HOME="$(mktemp -d)"
              buildCommand
            '';
            installPhase = ''
              mkdir -p $out
              mv out $out/out
            '';
          };
        };
      }
    );
}
