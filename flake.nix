{
  description = "A basic flake for my devlog";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { nixpkgs, git-hooks, ... }:
    let
      forAllSystems =
        f:
        nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed (
          system: f (import nixpkgs { inherit system; })
        );

      # node_modules for the Vite builder (builder/). Vendored from
      # builder/package-lock.json (generated with `--legacy-peer-deps`, mirrored
      # by npmFlags below).
      #
      # After bumping deps: regenerate builder/package-lock.json, set
      # `npmDepsHash` to `lib.fakeHash`, run `nix build`, and copy the `got:` hash.
      nodeModulesFor =
        pkgs:
        pkgs.buildNpmPackage {
          pname = "devlog-node-deps";
          version = "0";
          src = pkgs.lib.cleanSourceWith {
            src = ./builder;
            filter =
              path: _type:
              let
                b = baseNameOf path;
              in
              b == "package.json" || b == "package-lock.json";
          };
          npmDepsHash = "sha256-kdl7W3Q2QvvqIxHCo0p8XlgSqQ7WYQKaIv+WMsNbm7k=";
          npmFlags = [ "--legacy-peer-deps" ];
          dontNpmBuild = true;
          # We only want node_modules, not a packaged/installed app.
          installPhase = ''
            runHook preInstall
            mkdir -p "$out"
            cp -r node_modules "$out/node_modules"
            runHook postInstall
          '';
        };

      # Everything `just build` shells out to. Single source of truth, shared by
      # the hermetic package build (runtimeInputs) and the devShell, so the two
      # can't drift. The build is a Vite project (builder/) bundled by `vite build`
      # and run under bun, so no separate node is needed; no Emacs.
      buildToolsFor =
        pkgs:
        with pkgs;
        [
          bun
          just
        ];

      buildCommandFor =
        pkgs:
        let
          nodeModules = nodeModulesFor pkgs;
        in
        pkgs.writeShellApplication {
          name = "build-command";
          runtimeInputs = buildToolsFor pkgs;
          text = ''
            [ -e builder/node_modules ] || ln -sfn ${nodeModules}/node_modules builder/node_modules
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
            [ -e builder/node_modules ] || ln -sfn ${nodeModules}/node_modules builder/node_modules
            ( cd builder && bun run linkcards "$@" )
          '';
        };

      # pre-commit: oxfmt + oxlint over builder/, check only (never rewrites the
      # staged files). Installed by entering the devShell; also a flake check.
      # Runs the locked tools from builder/node_modules (the nix-vendored copy
      # when absent), since type-aware oxlint needs the builder's deps anyway.
      preCommitFor =
        pkgs:
        let
          nodeModules = nodeModulesFor pkgs;
          builderHook =
            name: script:
            pkgs.writeShellApplication {
              name = "pre-commit-${name}";
              runtimeInputs = [ pkgs.bun ];
              text = ''
                [ -e builder/node_modules ] || ln -sfn ${nodeModules}/node_modules builder/node_modules
                cd builder && bun run ${script}
              '';
            };
          hook = name: script: {
            enable = true;
            name = "${name} (check only)";
            entry = "${builderHook name script}/bin/pre-commit-${name}";
            files = "^builder/";
            pass_filenames = false;
          };
        in
        git-hooks.lib.${pkgs.stdenv.hostPlatform.system}.run {
          src = ./.;
          hooks = {
            oxfmt = hook "oxfmt" "fmt:check";
            oxlint = hook "oxlint" "lint";
          };
        };
    in
    {
      checks = forAllSystems (pkgs: {
        pre-commit = preCommitFor pkgs;
      });
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
          inherit (preCommitFor pkgs) shellHook;
          packages =
            buildToolsFor pkgs
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
