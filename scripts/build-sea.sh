#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly SCRIPT_DIR
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
readonly ROOT_DIR

cd "${ROOT_DIR}"

printf 'Building SEA CJS bundles...\n'
node_modules/.bin/tsx scripts/build.ts --sea

# Detect the SEA fuse hash embedded in this Node.js binary (changes across Node versions).
# Disable pipefail in the subshell: strings gets SIGPIPE when grep exits early after -m1.
NODE_BIN=$(command -v node)
NODE_FUSE=$(
    set +o pipefail
    strings "${NODE_BIN}" | grep -m1 "NODE_SEA_FUSE_" | cut -d: -f1
)
if [[ -z "${NODE_FUSE}" ]]; then
    printf 'Error: could not detect NODE_SEA_FUSE in node binary at %s\n' "${NODE_BIN}" >&2
    exit 1
fi
printf 'Detected fuse: %s\n' "${NODE_FUSE}"

package_sea() {
    local config_json="${1}"
    local blob_file="${2}"
    local binary_name="${3}"
    local binary_path="dist/${binary_name}"

    printf 'Generating SEA blob for %s...\n' "${binary_name}"
    node --experimental-sea-config "${config_json}"

    printf 'Creating binary %s...\n' "${binary_name}"
    cp "${NODE_BIN}" "${binary_path}"

    printf 'Stripping macOS signature from %s...\n' "${binary_name}"
    codesign --remove-signature "${binary_path}"

    printf 'Injecting SEA blob into %s...\n' "${binary_name}"
    node_modules/.bin/postject "${binary_path}" NODE_SEA_BLOB "${blob_file}" \
        --sentinel-fuse "${NODE_FUSE}" \
        --macho-segment-name NODE_SEA

    printf 'Ad-hoc signing %s...\n' "${binary_name}"
    codesign --sign - "${binary_path}"

    printf 'Done: %s\n' "${binary_path}"
}

package_sea "sea-config-cli.json" "dist/sea-cli.blob" "repo-expert"
package_sea "sea-config-mcp.json" "dist/sea-mcp.blob" "letta-tools"

printf 'SEA packaging complete!\n'
