#!/usr/bin/env sh
set -eu

# Knolo installer. It installs the native CLI from this checkout when run from
# the repository, or from the configured Git repository when piped from curl.

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository=${KNOLO_REPOSITORY:-https://github.com/knolo-ai/knolo-agents}
branch=${KNOLO_BRANCH:-main}
install_prefix=${KNOLO_INSTALL_DIR:-${XDG_BIN_HOME:-"$HOME/.local"}}
bin_dir="$install_prefix/bin"

if ! command -v cargo >/dev/null 2>&1; then
    cargo_available=0
else
    cargo_available=1
fi

mkdir -p "$bin_dir"

install_from_source() {
    if [ "$cargo_available" -ne 1 ]; then
        return 1
    fi
    if [ -f "$script_dir/Cargo.toml" ] && [ -d "$script_dir/crates/knolo-agent" ]; then
        echo "Installing Knolo from $script_dir"
        cargo install --path "$script_dir/crates/knolo-agent" --bin knolo --root "$install_prefix"
    else
        echo "Installing Knolo from $repository ($branch)"
        cargo install --git "$repository" --branch "$branch" --package knolo-agent --bin knolo --root "$install_prefix"
    fi
}

download_release_binary() {
    machine=$(uname -m)
    operating_system=$(uname -s)
    case "$operating_system/$machine" in
        Linux/x86_64) target="x86_64-unknown-linux-gnu" ;;
        Linux/aarch64|Linux/arm64) target="aarch64-unknown-linux-gnu" ;;
        Darwin/x86_64) target="x86_64-apple-darwin" ;;
        Darwin/arm64|Darwin/aarch64) target="aarch64-apple-darwin" ;;
        *) return 1 ;;
    esac
    if ! command -v curl >/dev/null 2>&1; then
        return 1
    fi
    if [ -n "${KNOLO_BINARY_URL:-}" ]; then
        binary_url=$KNOLO_BINARY_URL
    elif [ -n "${KNOLO_VERSION:-}" ]; then
        binary_url="$repository/releases/download/$KNOLO_VERSION/knolo-$target.tar.gz"
    else
        binary_url="$repository/releases/latest/download/knolo-$target.tar.gz"
    fi
    temporary_dir=$(mktemp -d)
    trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM
    if ! curl -fsSL "$binary_url" -o "$temporary_dir/knolo.tar.gz"; then
        return 1
    fi
    tar -xzf "$temporary_dir/knolo.tar.gz" -C "$temporary_dir"
    if [ ! -f "$temporary_dir/knolo" ]; then
        return 1
    fi
    chmod 0755 "$temporary_dir/knolo"
    mv "$temporary_dir/knolo" "$bin_dir/knolo"
    echo "Installed Knolo binary for $target"
}

installed=0
if [ -f "$script_dir/Cargo.toml" ] && [ -d "$script_dir/crates/knolo-agent" ]; then
    if install_from_source; then
        installed=1
    fi
else
    if [ "${KNOLO_USE_SOURCE:-0}" != "1" ] && download_release_binary; then
        installed=1
    elif install_from_source; then
        installed=1
    fi
fi

if [ "$installed" -ne 1 ] || [ ! -x "$bin_dir/knolo" ]; then
    echo "Knolo could not be installed." >&2
    echo "Install Rust from https://rustup.rs/ or set KNOLO_BINARY_URL to a Knolo release archive." >&2
    exit 1
fi

echo "Knolo installed at $bin_dir/knolo"
case ":${PATH}:" in
    *:"$bin_dir":*) ;;
    *) echo "Add it to PATH: export PATH=\"$bin_dir:\$PATH\"" ;;
esac
echo "Start with: $bin_dir/knolo init"
