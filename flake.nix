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

      # node_modules for the bun build (build.ts + scripts/*).
      #
      # After bumping deps: regenerate `package-lock.json`, set `npmDepsHash` to
      # `lib.fakeHash`, run `nix build`, and copy the `got:` hash from the error.
      nodeModulesFor =
        pkgs:
        pkgs.buildNpmPackage {
          pname = "devlog-node-deps";
          version = "0";
          src = pkgs.lib.cleanSourceWith {
            src = ./.;
            filter =
              path: _type:
              let
                b = baseNameOf path;
              in
              b == "package.json" || b == "package-lock.json";
          };
          npmDepsHash = "sha256-KZAn5QP/3r0g8wG6cth4pfRn074yeGvTjC+wiQXIZEM=";
          dontNpmBuild = true;
          # We only want node_modules, not a packaged/installed app.
          installPhase = ''
            runHook preInstall
            mkdir -p "$out"
            cp -r node_modules "$out/node_modules"
            runHook postInstall
          '';
        };

      # Everything the default `just build` (uniorg/bun) shells out to. Single
      # source of truth, shared by the hermetic package build (runtimeInputs) and
      # the devShell, so the two can't drift. Asset minification (CSS + TS) and
      # the whole render+bake go through bun, so no esbuild / Prettier / Emacs.
      # (linkcard fetch is best-effort and skipped offline.)
      buildToolsFor =
        pkgs:
        with pkgs;
        [
          bun
          just
        ];

      # Emacs (+ packages) for the reference build, `just build-emacs`. Dev-only:
      # the shipped site is the bun build, so the hermetic package never needs it.
      emacsFor =
        pkgs:
        pkgs.emacs.pkgs.withPackages (
          epkgs: with epkgs; [
            seq
            esxml
          ]
        );

      buildCommandFor =
        pkgs:
        let
          nodeModules = nodeModulesFor pkgs;
        in
        pkgs.writeShellApplication {
          name = "build-command";
          runtimeInputs = buildToolsFor pkgs;
          text = ''
            [ -e node_modules ] || ln -sfn ${nodeModules}/node_modules ./node_modules
            # CI=1: strict (fail on unknown language / KaTeX error / uncached card)
            CI=1 just build
          '';
        };

      linkcardCmdFor =
        pkgs:
        let
          nodeModules = nodeModulesFor pkgs;
        in
        pkgs.writeShellApplication {
          name = "linkcard";
          runtimeInputs = [ pkgs.bun ];
          text = ''
            [ -e node_modules ] || ln -sfn ${nodeModules}/node_modules ./node_modules
            bun scripts/fetch-linkcards.ts "$@"
          '';
        };
    in
    {
      apps = forAllSystems (pkgs: {
        build = {
          type = "app";
          program = "${buildCommandFor pkgs}/bin/build-command";
        };
        linkcard = {
          type = "app";
          program = "${linkcardCmdFor pkgs}/bin/linkcard";
        };
      });
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages =
            buildToolsFor pkgs
            ++ [ (emacsFor pkgs) ] # for `just build-emacs`
            ++ (with pkgs; [
              # dev-only tooling (not needed by the hermetic build)
              pinact
              watchexec
              zizmor
              imagemagick # to-webp.ts
              libwebp # to-webp.ts
            ]);
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
