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

# --- resolve the download URL + auth ---
# Public repo: the releases/latest/download/<asset> shortcut works with no auth.
# Private repo: that shortcut 404s for everyone — a private asset must be fetched
# via the authenticated API endpoint (Accept: octet-stream → signed redirect).
# So when GITHUB_TOKEN is set, resolve the asset id through the API and use it;
# otherwise try the public shortcut.
mkdir -p "$INSTALL_DIR"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if [ -n "${GITHUB_TOKEN:-}" ]; then
	api="https://api.github.com/repos/${OWNER_REPO}/releases/latest"
	# Resolve the asset id from the release JSON. python3 is the robust path
	# (independent of GitHub's field ordering); grep -B is the fallback.
	json="$(curl -fsSL \
		-H "Authorization: Bearer ${GITHUB_TOKEN}" \
		-H "Accept: application/vnd.github+json" \
		"$api")"
	if command -v python3 >/dev/null 2>&1; then
		asset_id="$(printf '%s' "$json" | python3 -c "import json,sys;print(next((a['id'] for a in json.load(sys.stdin).get('assets',[]) if a.get('name')=='${asset}'),''))" || true)"
	else
		asset_id="$(printf '%s' "$json" | grep -B4 "\"name\": \"${asset}\"" | grep -oE "\"id\": [0-9]+" | tail -1 | grep -oE "[0-9]+" || true)"
	fi
	if [ -z "${asset_id:-}" ]; then
		echo "✗ No '${asset}' found in the latest release." >&2
		echo "  Check the token has access to ${OWNER_REPO}, and the asset exists:" >&2
		echo "    https://github.com/${OWNER_REPO}/releases/latest" >&2
		exit 1
	fi
	dl_url="https://api.github.com/repos/${OWNER_REPO}/releases/assets/${asset_id}"
	curl_flags=(-H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/octet-stream")
else
	dl_url="https://github.com/${OWNER_REPO}/releases/latest/download/${asset}"
	curl_flags=()
fi

echo "↓ Downloading ${asset}…"
# ${curl_flags[@]+...} expands safely to nothing when the array is empty — a bare
# "${curl_flags[@]}" trips `set -u` on older bashes (e.g. macOS 3.2).
if ! curl -fL --progress-bar "${curl_flags[@]+"${curl_flags[@]}"}" "$dl_url" -o "$tmp"; then
	echo "" >&2
	echo "✗ Download failed: ${dl_url}" >&2
	if [ -z "${GITHUB_TOKEN:-}" ]; then
		echo "  If ${OWNER_REPO} is a private repo, set a read-access token first:" >&2
		echo "    export GITHUB_TOKEN=ghp_…   # then re-run this installer" >&2
	fi
	echo "  Available assets: https://github.com/${OWNER_REPO}/releases/latest" >&2
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
