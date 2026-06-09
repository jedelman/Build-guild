{
  description = "Build-guild — reproducible dev / test / deploy environment (Cloudflare Worker + SPA)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAll (system:
        let
          pkgs = import nixpkgs { inherit system; };
          # wrangler ships `workerd` as a PREBUILT binary (fetched by npm), and we drive a
          # browser for the smoke tests — both assume a standard FHS filesystem that NixOS
          # doesn't provide. An FHS shell makes them (and a nix-provided Chromium) run
          # unmodified, so the box behaves like a vanilla Linux dev machine.
          fhs = pkgs.buildFHSEnv {
            name = "buildguild-dev";
            targetPkgs = p: with p; [
              nodejs_22            # matches the project's Node 22 baseline
              chromium             # nix-provided browser for scripts/smoke-browser.mjs
              git curl jq cacert
              # runtime libs the prebuilt binaries (workerd) + headless Chromium link against
              stdenv.cc.cc.lib zlib openssl glib nss nspr
              atk at-spi2-atk at-spi2-core cups dbus expat
              libdrm libxkbcommon mesa alsa-lib pango cairo fontconfig freetype
              gtk3 gdk-pixbuf
              xorg.libX11 xorg.libXcomposite xorg.libXdamage xorg.libXext
              xorg.libXfixes xorg.libXrandr xorg.libxcb xorg.libXrender xorg.libXtst
            ];
            profile = ''
              # Point the browser smoke at the nix Chromium and stop Playwright from fetching
              # its own (incompatible-on-NixOS) build.
              export CHROMIUM_PATH="$(command -v chromium)"
              export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
              export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1
              echo "▶ build-guild dev shell — node $(node -v), chromium=$CHROMIUM_PATH"
              echo "  next: npm ci  ·  npm test  ·  /smoke-test  (see notes/dev-environment.md)"
            '';
            runScript = "bash";
          };
        in
        {
          # `nix develop` drops you into the FHS shell with the toolchain ready.
          default = fhs.env;
        });
    };
}
