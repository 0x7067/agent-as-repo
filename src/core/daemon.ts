import * as path from "path";

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

export function generatePlist(config: DaemonConfig): string {
  const nodeBinDir = path.dirname(config.nodePath);
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
\t\t<string>${config.nodePath}</string>
\t\t<string>${config.tsxCliPath}</string>
\t\t<string>src/cli.ts</string>
\t\t<string>watch</string>
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
\t\t<string>${nodeBinDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
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
