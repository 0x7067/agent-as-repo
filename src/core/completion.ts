export type CompletionShell = "bash" | "zsh" | "fish";

const COMMANDS = [
  "init",
  "doctor",
  "self-check",
  "setup",
  "config",
  "ask",
  "sync",
  "list",
  "status",
  "export",
  "onboard",
  "destroy",
  "watch",
  "install-daemon",
  "uninstall-daemon",
  "mcp-install",
  "mcp-check",
  "completion",
  "help",
].join(" ");

const GLOBAL_FLAGS = ["--help", "--version", "--no-input", "--debug"].join(" ");

function bashCompletion(commandName: string): string {
  return `# bash completion for ${commandName}
_${commandName.replace(/-/g, "_")}_completion() {
  local cur prev words cword
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${COMMANDS} ${GLOBAL_FLAGS}" -- "$cur") )
    return 0
  fi

  case "\${COMP_WORDS[1]}" in
    setup)
      COMPREPLY=( $(compgen -W "--repo --config --resume --reindex --json --load-retries --bootstrap-retries --load-timeout-ms --bootstrap-timeout-ms --help" -- "$cur") )
      ;;
    sync)
      COMPREPLY=( $(compgen -W "--repo --full --since --config --json --dry-run --help" -- "$cur") )
      ;;
    destroy)
      COMPREPLY=( $(compgen -W "--repo --force --dry-run --help" -- "$cur") )
      ;;
    config)
      COMPREPLY=( $(compgen -W "lint --help" -- "$cur") )
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish --install-dir --help" -- "$cur") )
      ;;
    *)
      COMPREPLY=()
      ;;
  esac
}

complete -F _${commandName.replace(/-/g, "_")}_completion ${commandName}
`;
}

function zshCompletion(commandName: string): string {
  return `#compdef ${commandName}

_arguments -C \\
  '1:command:(${COMMANDS})' \\
  '*::arg:->args'

case $state in
  args)
    case $words[2] in
      setup)
        _values 'setup options' --repo --config --resume --reindex --json --load-retries --bootstrap-retries --load-timeout-ms --bootstrap-timeout-ms
        ;;
      sync)
        _values 'sync options' --repo --full --since --config --json --dry-run
        ;;
      destroy)
        _values 'destroy options' --repo --force --dry-run
        ;;
      config)
        _values 'config subcommands' lint
        ;;
      completion)
        _values 'shells' bash zsh fish --install-dir
        ;;
    esac
    ;;
esac
`;
}

function fishCompletion(commandName: string): string {
  return `# fish completion for ${commandName}
complete -c ${commandName} -f
complete -c ${commandName} -n "__fish_use_subcommand" -a "${COMMANDS}"
complete -c ${commandName} -l no-input -d "Disable interactive prompts"
complete -c ${commandName} -l debug -d "Show stack traces for unexpected errors"

complete -c ${commandName} -n "__fish_seen_subcommand_from setup" -l repo
complete -c ${commandName} -n "__fish_seen_subcommand_from setup" -l config
complete -c ${commandName} -n "__fish_seen_subcommand_from setup" -l resume
complete -c ${commandName} -n "__fish_seen_subcommand_from setup" -l reindex
complete -c ${commandName} -n "__fish_seen_subcommand_from setup" -l json

complete -c ${commandName} -n "__fish_seen_subcommand_from sync" -l repo
complete -c ${commandName} -n "__fish_seen_subcommand_from sync" -l full
complete -c ${commandName} -n "__fish_seen_subcommand_from sync" -l since
complete -c ${commandName} -n "__fish_seen_subcommand_from sync" -l config
complete -c ${commandName} -n "__fish_seen_subcommand_from sync" -l json
complete -c ${commandName} -n "__fish_seen_subcommand_from sync" -l dry-run

complete -c ${commandName} -n "__fish_seen_subcommand_from completion" -a "bash zsh fish"
complete -c ${commandName} -n "__fish_seen_subcommand_from completion" -l install-dir
`;
}

export function generateCompletionScript(shell: CompletionShell, commandName = "repo-expert"): string {
  if (shell === "bash") return bashCompletion(commandName);
  if (shell === "zsh") return zshCompletion(commandName);
  return fishCompletion(commandName);
}

export function completionFileName(shell: CompletionShell, commandName = "repo-expert"): string {
  if (shell === "bash") return `${commandName}.bash`;
  if (shell === "zsh") return `_${commandName}`;
  return `${commandName}.fish`;
}
