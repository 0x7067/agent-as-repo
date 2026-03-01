import * as path from "node:path";

export const PLIST_LABEL = "com.denguinho.repo-expert-watch";

export interface DaemonConfig {
  workingDirectory: string;
  nodePath: string;
  tsxCliPath: string;
  intervalSeconds: number;
  debounceMs: number;
  configPath: string;
  logPath: string;
}

export interface DaemonBinaryConfig {
  workingDirectory: string;
  binaryPath: string;
  intervalSeconds: number;
  debounceMs: number;
  configPath: string;
  logPath: string;
}

export function generatePlist(config: DaemonConfig | DaemonBinaryConfig): string {
  const programArgs =
    "binaryPath" in config
      ? `\t\t<string>${config.binaryPath}</string>\n\t\t<string>watch</string>`
      : `\t\t<string>${config.nodePath}</string>\n\t\t<string>${config.tsxCliPath}</string>\n\t\t<string>src/cli.ts</string>\n\t\t<string>watch</string>`;

  const binDir =
    "binaryPath" in config
      ? path.dirname(config.binaryPath)
      : path.dirname(config.nodePath);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${PLIST_LABEL}</string>

\t<key>WorkingDirectory</key>
\t<string>${config.workingDirectory}</string>

\t<key>ProgramArguments</key>
\t<array>
${programArgs}
\t\t<string>--interval</string>
\t\t<string>${config.intervalSeconds}</string>
\t\t<string>--debounce</string>
\t\t<string>${config.debounceMs}</string>
\t\t<string>--config</string>
\t\t<string>${config.configPath}</string>
\t</array>

\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>PATH</key>
\t\t<string>${binDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
\t</dict>

\t<key>RunAtLoad</key>
\t<true/>

\t<key>KeepAlive</key>
\t<true/>

\t<key>StandardOutPath</key>
\t<string>${config.logPath}</string>

\t<key>StandardErrorPath</key>
\t<string>${config.logPath}</string>

\t<key>ThrottleInterval</key>
\t<integer>60</integer>
</dict>
</plist>
`;
}
