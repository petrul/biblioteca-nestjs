#!/usr/bin/env bash

set -euo pipefail

repo_root="${NPM_REPO:-/media/gv0/repo/npm}"
package_name="$(node -p "require('./package.json').name")"
package_version="$(node -p "require('./package.json').version")"

if [[ "$package_version" == *-* ]]; then
  repository="snapshots"
else
  repository="releases"
fi

artifact_name="${package_name//@/}"
artifact_name="${artifact_name//\//-}-${package_version}.tgz"
destination="$repo_root/$repository/$package_name/$package_version"
artifact="$destination/$artifact_name"

if [[ -e "$artifact" ]]; then
  echo "Refusing to overwrite published artifact: $artifact" >&2
  exit 1
fi

npm run build

stage_dir="$(mktemp -d)"
trap 'rm -rf "$stage_dir"' EXIT

npm_config_cache="${TMPDIR:-/tmp}/textbase-vectorizer-npm-cache" \
  npm pack --pack-destination "$stage_dir" >/dev/null

mkdir -p "$destination"
mv -n "$stage_dir/$artifact_name" "$artifact"

if [[ ! -e "$artifact" ]]; then
  echo "Another publisher created the artifact first: $artifact" >&2
  exit 1
fi

(
  cd "$destination"
  sha256sum "$artifact_name" > "$artifact_name.sha256"
)

echo "Published $artifact"
