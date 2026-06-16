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

      # For `scripts/postprocess.ts`.
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
          npmDepsHash = "sha256-hEMkfI5hqRVOmAJiLM7LSKFNccjq599BjwiN8IQSvIU=";
          dontNpmBuild = true;
          # We only want node_modules, not a packaged/installed app.
          installPhase = ''
            runHook preInstall
            mkdir -p "$out"
            cp -r node_modules "$out/node_modules"
            runHook postInstall
          '';
        };

      buildCommandFor =
        pkgs:
        let
          nodeModules = nodeModulesFor pkgs;
        in
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
            bun
            esbuild
            just
          ];
          text = ''
            # Make the vendored deps resolvable by `bun` from the build cwd
            # (skip when a real node_modules already exists, e.g. local runs).
            [ -e node_modules ] || ln -sfn ${nodeModules}/node_modules ./node_modules
            # Reuse the Justfile build verbatim, so this never drifts from a local
            # build. Run as an app (`nix run .#build`), not a sandboxed package, so
            # the link-card fetch has network. CI=1 -> strict post-process.
            CI=1 just build --release
          '';
        };

      # `nix run .#linkcard` -- fetch OGP/GitHub metadata into linkcard-cache.json
      # using the vendored deps. Runs *outside* the sandbox (network is allowed),
      # so CI can regenerate the cache from the committed tree before `nix build`,
      # keeping the cache out of git (no unpublished-draft leak) yet present for
      # the hermetic build. Passes args through (e.g. `nix run .#linkcard -- --force`).
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
          packages = with pkgs; [
            nodePackages.prettier
            pinact
            watchexec
            zizmor
            just
            esbuild # `just min-css`
            # used by the image scripts in scripts/ and scripts/postprocess.ts
            bun
            libwebp # to-webp.ts: cwebp / gif2webp / webpmux
            imagemagick # to-webp.ts: identify (dimensions) + magick (gif resize)
          ];
        };
      });
      packages = forAllSystems (pkgs: rec {
        default = devlog;
        # Vendored node deps, exposed so `nix build .#node-deps` can surface the
        # real `npmDepsHash` after a dependency bump.
        node-deps = nodeModulesFor pkgs;
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
