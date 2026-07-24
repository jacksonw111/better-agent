#!/usr/bin/env bash
# Compiles native/pty-broker.c for a given target and prints the output path.
# Used by CI (release-cli.yml) and by the local `compile` npm script.
#
# Usage: build-broker.sh <target> <out-path>
#   target ∈ { darwin-arm64, darwin-x64, linux-x64, linux-arm64 }
#
# No third-party deps: libc + libutil (forkpty). Linux links -lutil dynamically
# against glibc — the same baseline the Bun-compiled CLI itself requires — and
# uses the cross-gcc (gcc-aarch64-linux-gnu) when the host arch differs.
set -euo pipefail

target="${1:?usage: build-broker.sh <target> <out>}"
out="${2:?usage: build-broker.sh <target> <out>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="${here}/../native/pty-broker.c"
host_arch="$(uname -m)"

case "${target}" in
  darwin-arm64)
    cc -O2 -arch arm64 -o "${out}" "${src}"
    ;;
  darwin-x64)
    cc -O2 -arch x86_64 -o "${out}" "${src}"
    ;;
  linux-x64)
    if [ "${host_arch}" = "x86_64" ]; then
      cc -O2 -o "${out}" "${src}" -lutil
    else
      x86_64-linux-gnu-gcc -O2 -o "${out}" "${src}" -lutil
    fi
    ;;
  linux-arm64)
    if [ "${host_arch}" = "aarch64" ] || [ "${host_arch}" = "arm64" ]; then
      cc -O2 -o "${out}" "${src}" -lutil
    else
      aarch64-linux-gnu-gcc -O2 -o "${out}" "${src}" -lutil
    fi
    ;;
  *)
    echo "build-broker: unknown target '${target}'" >&2
    exit 2
    ;;
esac

echo "${out}"
