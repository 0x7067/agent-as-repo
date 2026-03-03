#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
readonly SCRIPT_DIR
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
readonly ROOT_DIR

cd "${ROOT_DIR}"

printf 'Building SEA CJS bundles...\n'
node_modules/.bin/tsx scripts/build.ts --sea

# Find a Node.js binary that supports SEA fuse probing.
find_node_with_sea_fuse() {
    local candidates=()
    if [[ -n "${NODE_SEA_BIN:-}" ]]; then
        candidates+=("${NODE_SEA_BIN}")
    fi
    candidates+=("$(command -v node)")
    while IFS= read -r node_path; do
        [[ -n "${node_path}" ]] || continue
        candidates+=("${node_path}")
    done < <(which -a node 2>/dev/null || true)

    local seen=""
    for node_path in "${candidates[@]}"; do
        [[ -x "${node_path}" ]] || continue
        [[ ":${seen}:" == *":${node_path}:"* ]] && continue
        seen="${seen}:${node_path}"

        local node_fuse
        node_fuse=$(
            set +o pipefail
            strings "${node_path}" | grep -m1 "NODE_SEA_FUSE_" | cut -d: -f1
        )
        if [[ -n "${node_fuse}" ]]; then
            NODE_BIN="${node_path}"
            NODE_FUSE="${node_fuse}"
            return 0
        fi
    done

    return 1
}

NODE_BIN=""
NODE_FUSE=""
if ! find_node_with_sea_fuse; then
    printf 'Error: could not find a Node.js binary with NODE_SEA_FUSE support.\n' >&2
    printf 'Hint: set NODE_SEA_BIN to a compatible Node (e.g. a Node 24.x binary with SEA fuse).\n' >&2
    exit 1
fi
printf 'Using SEA Node: %s\n' "${NODE_BIN}"
printf 'Detected fuse: %s\n' "${NODE_FUSE}"

package_sea() {
    local config_json="${1}"
    local blob_file="${2}"
    local binary_name="${3}"
    local binary_path="dist/${binary_name}"

    printf 'Generating SEA blob for %s...\n' "${binary_name}"
    "${NODE_BIN}" --experimental-sea-config "${config_json}"

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
