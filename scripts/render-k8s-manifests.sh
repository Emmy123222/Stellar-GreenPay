#!/usr/bin/env bash
#
# Render the k8s/ Kustomize base with a concrete, immutable image tag.
#
# The manifests in k8s/ intentionally reference their images as
#   image: greenpay/<service>:${GIT_SHA}
# so that a deployment can never accidentally run the mutable `latest` tag.
# This script resolves the ${GIT_SHA} placeholder to a real tag (typically the
# short git SHA produced by CI) and prints the resulting manifests to stdout.
#
# Usage:
#   scripts/render-k8s-manifests.sh <image-tag> [output-file]
#
# Examples:
#   scripts/render-k8s-manifests.sh "$(git rev-parse --short HEAD)"
#   scripts/render-k8s-manifests.sh 1.4.0 rendered/k8s.yaml
#
set -euo pipefail

tag="${1:-}"
out="${2:-}"

if [[ -z "${tag}" ]]; then
  echo "error: an image tag is required (e.g. the short git SHA)" >&2
  echo "usage: $(basename "$0") <image-tag> [output-file]" >&2
  exit 1
fi

if [[ "${tag}" == "latest" ]]; then
  echo "error: refusing to render manifests with the mutable 'latest' tag" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
k8s_dir="${repo_root}/k8s"

render() {
  if command -v kubectl >/dev/null 2>&1; then
    kubectl kustomize "${k8s_dir}"
    return
  fi

  # Fallback for environments without kubectl: concatenate the resources in the
  # order declared by kustomization.yaml.
  echo "warning: kubectl not found; falling back to plain resource concatenation" >&2
  local resource
  while IFS= read -r resource; do
    [[ -z "${resource}" ]] && continue
    cat "${k8s_dir}/${resource}"
    echo "---"
  done < <(grep -E '^\s*-\s+.*\.yaml$' "${k8s_dir}/kustomization.yaml" | sed -E 's/^\s*-\s+//')
}

rendered="$(render | sed "s|\${GIT_SHA}|${tag}|g")"

if [[ "${rendered}" == *'${GIT_SHA}'* ]]; then
  echo "error: unresolved \${GIT_SHA} placeholder left in rendered manifests" >&2
  exit 1
fi

if grep -qE 'image: .*:latest([[:space:]]|$)' <<<"${rendered}"; then
  echo "error: rendered manifests still reference a mutable 'latest' image tag" >&2
  exit 1
fi

if [[ -n "${out}" ]]; then
  mkdir -p "$(dirname "${out}")"
  printf '%s\n' "${rendered}" > "${out}"
  echo "Rendered k8s manifests with image tag '${tag}' to ${out}" >&2
else
  printf '%s\n' "${rendered}"
fi
