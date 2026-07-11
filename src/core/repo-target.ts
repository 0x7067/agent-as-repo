/** Result of reconciling a positional repo argument against a `--repo` flag. */
export interface RepoTargetResult {
  repo?: string;
  error?: string;
}

/**
 * Resolve a command's repo target from an optional positional argument and an
 * optional `--repo` flag kept for back-compat (some commands, e.g. `ask` and
 * `onboard`, take the repo positionally; others, e.g. `export` and `destroy`,
 * historically only accepted `--repo`). Both may be given if they agree;
 * disagreeing values are a user error worth failing on rather than silently
 * preferring one.
 */
export function resolveRepoTarget(positional: string | undefined, flag: string | undefined): RepoTargetResult {
  if (positional !== undefined && flag !== undefined && positional !== flag) {
    return {
      error: `Conflicting repo targets: positional "${positional}" and --repo "${flag}" — pass only one.`,
    };
  }
  const repo = positional ?? flag;
  return repo === undefined ? {} : { repo };
}
