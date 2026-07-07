#!/usr/bin/env bash
#
# install.sh — install the better-agent-bridge CLI as a standalone binary.
# No Node.js / npm needed: Bun --compile embeds the runtime, so this is one
# self-contained executable.
#
#   curl -fsSL https://github.com/jacksonw111/better-agent/releases/latest/download/install.sh | bash
#
# Downloads the binary for your platform from the latest GitHub Release and
# installs it to ~/.better-agent/bin, then tells you how to add it to PATH.
# Override the destination with:  INSTALL_DIR=... bash install.sh
set -euo pipefail

OWNER_REPO="${OWNER_REPO:-jacksonw111/better-agent}"
BIN_NAME="better-agent-bridge"
INSTALL_DIR="${INSTALL_DIR:-${HOME}/.better-agent/bin}"

# --- platform detection ---
case "$(uname -s)" in
	Darwin) os="darwin" ;;
	Linux)  os="linux" ;;
	*)
		echo "✗ Unsupported OS: $(uname -s) (better-agent-bridge ships for macOS/Linux only)" >&2
		exit 1
		;;
esac
case "$(uname -m)" in
	x86_64|amd64)  arch="x64" ;;
	arm64|aarch64) arch="arm64" ;;
	*)
		echo "✗ Unsupported architecture: $(uname -m) (only x64/arm64)" >&2
		exit 1
		;;
esac

asset="${BIN_NAME}-${os}-${arch}"
url="https://github.com/${OWNER_REPO}/releases/latest/download/${asset}"

# --- download + install ---
mkdir -p "$INSTALL_DIR"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

echo "↓ Downloading ${asset}…"
if ! curl -fL --progress-bar "$url" -o "$tmp"; then
	echo "" >&2
	echo "✗ Download failed: ${url}" >&2
	echo "  Most likely no '${asset}' binary is attached to the latest release." >&2
	echo "  Check available assets: https://github.com/${OWNER_REPO}/releases/latest" >&2
	exit 1
fi
chmod +x "$tmp"
mv "$tmp" "${INSTALL_DIR}/${BIN_NAME}"
trap - EXIT

echo "✓ Installed ${BIN_NAME} → ${INSTALL_DIR}/${BIN_NAME}"

# --- PATH hint (only when the install dir isn't already on PATH) ---
case ":${PATH}:" in
	*":${INSTALL_DIR}:"*) ;;
	*)
		rc=""
		case "${SHELL:-}" in
			*/zsh)  rc="${HOME}/.zshrc" ;;
			*/bash) rc="${HOME}/.bashrc" ;;
		esac
		hint="Add ${INSTALL_DIR} to your PATH"
		if [[ -n "$rc" ]]; then
			hint="${hint} (e.g. append to ${rc})"
		fi
		echo ""
		echo "${hint}:"
		echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
		;;
esac
echo ""
echo "Then run:  ${BIN_NAME} --agent claude-code --token <bt_…> --server <url>"
echo "Docs:      https://github.com/${OWNER_REPO}/tree/dev/apps/bridge-cli#readme"
