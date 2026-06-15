{
  description = "A basic flake for my devlog";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      forAllSystems =
        f:
        nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed (
          system: f (import nixpkgs { inherit system; })
        );
      buildCommandFor =
        pkgs:
        pkgs.writeShellApplication {
          name = "build-command";
          runtimeInputs = with pkgs; [
            (emacs.pkgs.withPackages (
              epkgs: with epkgs; [
                seq
                esxml
              ]
            ))
            nodePackages.prettier
          ];
          text = ''
            emacs -Q --script "./build.el" -- "--release"
            prettier --print-width 100 --write out/*.html out/diary/*.html
          '';
        };
    in
    {
      apps = forAllSystems (pkgs: {
        build = {
          type = "app";
          program = "${buildCommandFor pkgs}/bin/build-command";
        };
      });
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodePackages.prettier
            pinact
            watchexec
            zizmor
          ];
        };
      });
      packages = forAllSystems (pkgs: rec {
        default = devlog;
        devlog = pkgs.stdenvNoCC.mkDerivation {
          name = "devlog";
          src = ./.;
          nativeBuildInputs = [
            (buildCommandFor pkgs)
          ];
          buildPhase = ''
            export HOME="$(mktemp -d)"
            build-command
          '';
          installPhase = ''
            mkdir -p "$out"
            mv out "$out/out"
          '';
        };
      });
    };
}
