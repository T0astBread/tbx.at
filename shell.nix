{ pkgs ? import <nixpkgs> { } }:

with pkgs;

let
  build = writeShellScriptBin "build" ''
    node_modules/.bin/tsc
    ${nodejs}/bin/node build.js
  '';
  serve = writeShellScriptBin "serve" ''
    trap 'kill "$caddy_pid"' EXIT
    mkdir -p build
    ${caddy}/bin/caddy file-server -listen :8080 -root build &
    readonly caddy_pid="$!"
    wait "$caddy_pid"
  '';
  watch = writeShellScriptBin "watch" ''
    trap 'kill "$serve_pid" "$tsc_pid"' EXIT
    ${serve}/bin/serve &
    readonly serve_pid="$!"

    node_modules/.bin/tsc # Build once in case there were errors in the previous program.
    node_modules/.bin/tsc -w &
    readonly tsc_pid="$!"

    while :; do
      OP=watch ${nodejs}/bin/node build.js
      [[ "$?" != 5 ]] && break
      echo "Restarting build process..."
    done
  '';
  open-browser = writeShellScriptBin "open-browser" ''
    ${qutebrowser}/bin/qutebrowser http://127.0.0.1:8080
  '';
in
mkShell {
  packages = [
    caddy
    nodejs

    build
    serve
    watch
    open-browser
  ];
}
