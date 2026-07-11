/**
 * Recognize test/spec files from their path alone so retrieval can demote them
 * below real implementation. Pure heuristics — no I/O.
 *
 * Covers this repo's own colocated `foo.test.ts` convention plus the common
 * per-language patterns: Go `_test.go`, Ruby `_test.rb`, Python
 * `test_*.py` / `*_test.py`, JS/TS `.test.` / `.spec.`, and the `__tests__/`,
 * `__test__/`, `test/`, `tests/`, `spec/`, `specs/` directory conventions.
 * Directory heuristics alone are insufficient here because tests are colocated
 * with the code they exercise, so filename patterns matter most.
 */

const TEST_DIR_RE = /(?:^|\/)(?:__tests__|__test__|tests?|specs?)\//;
// `.test.` / `.spec.` colocated infix (e.g. chunker.test.ts, App.spec.tsx).
const DOT_TEST_RE = /\.(?:test|spec)\./;
// `_test.<ext>` colocated suffix (Go, Ruby, Python: server_test.go, user_test.rb).
const UNDERSCORE_TEST_RE = /_test\.[a-z0-9]+$/;
// Python `test_*.py` prefix convention.
const PY_TEST_PREFIX_RE = /^test_.*\.py$/;

export function isTestPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  if (TEST_DIR_RE.test(normalized)) return true;

  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  return (
    DOT_TEST_RE.test(base) ||
    UNDERSCORE_TEST_RE.test(base) ||
    PY_TEST_PREFIX_RE.test(base)
  );
}
