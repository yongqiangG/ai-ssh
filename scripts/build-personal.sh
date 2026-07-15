#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT_DIR/ssh-server"
CLIENT_DIR="$ROOT_DIR/ssh-client"
TAURI_DIR="$CLIENT_DIR/src-tauri"
TAURI_PERSONAL_CONFIG="$TAURI_DIR/tauri.personal.conf.json"
RESOURCE_DIR="$TAURI_DIR/resources"
BACKEND_RESOURCE_DIR="$RESOURCE_DIR/backend"
RUNTIME_RESOURCE_DIR="$RESOURCE_DIR/runtime"
BACKEND_JAR="$SERVER_DIR/ssh-server-app/target/ssh-server-app.jar"
WIX_TOOLS_DIR="$TAURI_DIR/target/.tauri/WixTools314"
WIX_ZIP_NAME="wix314-binaries.zip"
WIX_ZIP_SHA256="6ac824e1642d6f7277d0ed7ea09411a508f6116ba6fae0aa5f2c7daa2ff43d31"

SENSITIVE_ARCHIVE_NAMES_REGEX='(^|/)application-local\.ya?ml$|(^|/)\.env$|(^|/)secret\.key$|(^|/)ai-ssh\.mv\.db$'
SENSITIVE_TEXT_REGEX='((^|[[:space:]])ZHIPU_API_KEY:[[:space:]]*[^$[:space:]]+|(^|[[:space:]])GPT_API_KEY:[[:space:]]*[^$[:space:]]+|sk-[A-Za-z0-9_-]{12,}|api-key:[[:space:]]*[^$[:space:]][^[:space:]]+)'

log() {
  printf '\n\033[1;36m%s\033[0m\n' "$1"
}

fail() {
  printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

windows_path() {
  if command_exists cygpath; then
    cygpath -w "$1"
    return
  fi
  printf '%s' "$1"
}

is_windows_host() {
  [[ "${OS:-}" == "Windows_NT" || "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ]]
}

resolve_java_home() {
  if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/jlink" ]]; then
    printf '%s' "$JAVA_HOME"
    return
  fi

  local javac_path
  javac_path="$(command -v javac || true)"
  if [[ -n "$javac_path" ]]; then
    local java_home
    java_home="$(cd "$(dirname "$javac_path")/.." && pwd)"
    if [[ -x "$java_home/bin/jlink" ]]; then
      printf '%s' "$java_home"
      return
    fi
  fi

  fail "JDK with jlink was not found. Install JDK 17 and set JAVA_HOME."
}

check_tools() {
  command_exists mvn || fail "mvn was not found. Install Maven and add it to PATH."
  command_exists node || fail "node was not found. Install Node.js and add it to PATH."
  command_exists npm || fail "npm was not found. Install Node.js/npm."
  command_exists jar || fail "jar was not found. Use a JDK, not a JRE."
}

scan_source_resources() {
  log "0/6 Scan source resources for packaging risks"
  local resource_dir="$SERVER_DIR/ssh-server-app/src/main/resources"
  if find "$resource_dir" -type f \( -name "application-local.yml" -o -name "application-local.yaml" -o -name ".env" \) | grep -q .; then
    printf 'Local sensitive config exists under server resources. It will be excluded from the jar:\n'
    find "$resource_dir" -type f \( -name "application-local.yml" -o -name "application-local.yaml" -o -name ".env" \) -print
  fi
}

build_backend() {
  log "1/6 Build Spring Boot backend"
  (cd "$SERVER_DIR" && mvn -pl ssh-server-app -am -DskipTests clean package)
  [[ -f "$BACKEND_JAR" ]] || fail "Backend jar was not found: $BACKEND_JAR"
}

verify_backend_jar() {
  log "2/6 Verify backend jar does not contain local secrets"
  local listing
  listing="$(jar tf "$BACKEND_JAR")"
  if printf '%s\n' "$listing" | grep -E "$SENSITIVE_ARCHIVE_NAMES_REGEX" >/dev/null; then
    printf '%s\n' "$listing" | grep -E "$SENSITIVE_ARCHIVE_NAMES_REGEX" >&2
    fail "Backend jar contains a sensitive local file."
  fi

  local scan_dir
  scan_dir="$(mktemp -d)"
  (cd "$scan_dir" && jar xf "$BACKEND_JAR")
  if grep -RIE "$SENSITIVE_TEXT_REGEX" "$scan_dir/BOOT-INF/classes" >/dev/null 2>&1; then
    rm -rf "$scan_dir"
    fail "Backend jar contains a value that looks like a plain API key."
  fi
  rm -rf "$scan_dir"
}

build_runtime() {
  log "3/6 Build embedded Java runtime"
  local java_home
  java_home="$(resolve_java_home)"

  rm -rf "$RUNTIME_RESOURCE_DIR"
  mkdir -p "$RESOURCE_DIR"

  "$java_home/bin/jlink" \
    --add-modules java.se,java.instrument,jdk.crypto.ec,jdk.unsupported,jdk.zipfs \
    --strip-debug \
    --no-header-files \
    --no-man-pages \
    --compress=2 \
    --output "$RUNTIME_RESOURCE_DIR"

  [[ -x "$RUNTIME_RESOURCE_DIR/bin/java.exe" || -x "$RUNTIME_RESOURCE_DIR/bin/java" ]] \
    || fail "jlink runtime generation failed."
}

copy_backend_resource() {
  log "4/6 Copy backend resource into Tauri"
  rm -rf "$BACKEND_RESOURCE_DIR"
  mkdir -p "$BACKEND_RESOURCE_DIR"
  cp -f "$BACKEND_JAR" "$BACKEND_RESOURCE_DIR/ssh-server-app.jar"
}

install_client_dependencies() {
  log "5/6 Check frontend dependencies"
  if [[ ! -d "$CLIENT_DIR/node_modules" ]]; then
    if ! (cd "$CLIENT_DIR" && npm ci --no-audit --no-fund); then
      [[ -f "$CLIENT_DIR/node_modules/@tauri-apps/cli/tauri.js" ]] \
        || fail "npm ci failed before installing Tauri CLI."
      printf 'npm ci returned a non-zero exit code after installing dependencies; continuing.\n'
    fi
  fi
}

prepare_windows_bundle_tools() {
  is_windows_host || return 0
  [[ -f "$TAURI_PERSONAL_CONFIG" ]] || return 0
  [[ -x "$WIX_TOOLS_DIR/candle.exe" && -x "$WIX_TOOLS_DIR/light.exe" ]] && return 0

  log "Prepare local WiX tools"

  local wix_zip=""
  local candidate
  for candidate in \
    "${HOME:-}/Desktop/$WIX_ZIP_NAME" \
    "${USERPROFILE:-}/Desktop/$WIX_ZIP_NAME" \
    "$ROOT_DIR/$WIX_ZIP_NAME"; do
    if [[ -f "$candidate" ]]; then
      wix_zip="$candidate"
      break
    fi
  done

  [[ -n "$wix_zip" ]] || fail "WiX zip was not found. Download $WIX_ZIP_NAME from https://github.com/wixtoolset/wix3/releases/download/wix3141rtm/wix314-binaries.zip and place it on Desktop or project root."

  if command_exists sha256sum; then
    local actual_hash
    actual_hash="$(sha256sum "$wix_zip" | awk '{print tolower($1)}')"
    [[ "$actual_hash" == "$WIX_ZIP_SHA256" ]] || fail "WiX zip SHA256 mismatch."
  fi

  mkdir -p "$WIX_TOOLS_DIR"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \
    "Expand-Archive -LiteralPath '$(windows_path "$wix_zip")' -DestinationPath '$(windows_path "$WIX_TOOLS_DIR")' -Force" \
    >/dev/null

  [[ -x "$WIX_TOOLS_DIR/candle.exe" && -x "$WIX_TOOLS_DIR/light.exe" ]] \
    || fail "WiX tools extraction failed."
}

build_tauri() {
  log "6/6 Build Tauri bundle"
  local tauri_script="tauri:raw"
  local build_args=(build)
  if is_windows_host; then
    tauri_script="tauri"
  fi

  if [[ -n "${TAURI_TARGET:-}" ]]; then
    build_args+=(--target "$TAURI_TARGET")
  fi

  if [[ -f "$TAURI_PERSONAL_CONFIG" ]]; then
    build_args+=(--config src-tauri/tauri.personal.conf.json)
    (cd "$CLIENT_DIR" && npm run "$tauri_script" -- "${build_args[@]}")
    return
  fi
  (cd "$CLIENT_DIR" && npm run "$tauri_script" -- "${build_args[@]}")
}

verify_tauri_resources() {
  log "Verify Tauri resources"
  if find "$RESOURCE_DIR" -type f \( -name "application-local.yml" -o -name "application-local.yaml" -o -name ".env" -o -name "secret.key" -o -name "ai-ssh.mv.db" \) | grep -q .; then
    find "$RESOURCE_DIR" -type f \( -name "application-local.yml" -o -name "application-local.yaml" -o -name ".env" -o -name "secret.key" -o -name "ai-ssh.mv.db" \) -print >&2
    fail "Tauri resources contain a sensitive local file."
  fi
}

print_outputs() {
  log "Build complete"
  local bundle_dir="$TAURI_DIR/target/release/bundle"
  if [[ -n "${TAURI_TARGET:-}" ]]; then
    bundle_dir="$TAURI_DIR/target/$TAURI_TARGET/release/bundle"
  fi

  printf 'Bundle output directory:\n'
  printf '  %s\n' "$bundle_dir"
}

main() {
  check_tools
  scan_source_resources
  build_backend
  verify_backend_jar
  build_runtime
  copy_backend_resource
  verify_tauri_resources
  install_client_dependencies
  prepare_windows_bundle_tools
  build_tauri
  verify_tauri_resources
  print_outputs
}

main "$@"
