import { describe, it, expect } from "vitest";
import { generatePlist, PLIST_LABEL, type DaemonBinaryConfig } from "./daemon.js";

describe("PLIST_LABEL", () => {
  it("has the expected value", () => {
    expect(PLIST_LABEL).toBe("com.denguinho.repo-expert-watch");
  });
});

describe("generatePlist", () => {
  const config = {
    workingDirectory: "/home/user/repos/my-app",
    nodePath: "/home/user/.local/share/mise/installs/node/24.13.0/bin/node",
    tsxCliPath: "/home/user/repos/my-app/node_modules/tsx/dist/cli.mjs",
    intervalSeconds: 30,
    debounceMs: 250,
    configPath: "config.yaml",
    logPath: "/home/user/Library/Logs/repo-expert-watch.log",
  };

  it("contains the label", () => {
    const plist = generatePlist(config);
    expect(plist).toContain(`<string>${PLIST_LABEL}</string>`);
  });

  it("uses the provided node path", () => {
    const plist = generatePlist(config);
    expect(plist).toContain("<string>/home/user/.local/share/mise/installs/node/24.13.0/bin/node</string>");
  });

  it("uses the provided tsx cli path", () => {
    const plist = generatePlist(config);
    expect(plist).toContain("<string>/home/user/repos/my-app/node_modules/tsx/dist/cli.mjs</string>");
  });

  it("derives PATH from node parent directory", () => {
    const plist = generatePlist(config);
    expect(plist).toContain("/home/user/.local/share/mise/installs/node/24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
  });

  it("includes interval, debounce, and config arguments", () => {
    const plist = generatePlist(config);
    expect(plist).toContain("<string>30</string>");
    expect(plist).toContain("<string>250</string>");
    expect(plist).toContain("<string>config.yaml</string>");
  });

  it("sets working directory", () => {
    const plist = generatePlist(config);
    expect(plist).toContain("<string>/home/user/repos/my-app</string>");
  });

  it("sets log path for stdout and stderr", () => {
    const plist = generatePlist(config);
    const logOccurrences = plist.split(config.logPath).length - 1;
    expect(logOccurrences).toBe(2); // stdout + stderr
  });

  it("produces valid XML structure", () => {
    const plist = generatePlist(config);
    expect(plist).toMatch(/^<\?xml version="1\.0"/);
    expect(plist).toContain("<plist version=\"1.0\">");
    expect(plist).toContain("</plist>");
  });
});

describe("generatePlist (binary mode)", () => {
  const config: DaemonBinaryConfig = {
    workingDirectory: "/home/user/repos/my-app",
    binaryPath: "/home/user/repos/my-app/dist/repo-expert",
    intervalSeconds: 30,
    debounceMs: 250,
    configPath: "config.yaml",
    logPath: "/home/user/Library/Logs/repo-expert-watch.log",
  };

  it("uses the binary path directly as the program", () => {
    const plist = generatePlist(config);
    expect(plist).toContain("<string>/home/user/repos/my-app/dist/repo-expert</string>");
  });

  it("does not include node or tsx paths", () => {
    const plist = generatePlist(config);
    expect(plist).not.toContain("<string>node</string>");
    expect(plist).not.toContain("tsx");
    expect(plist).not.toContain("src/cli.ts");
  });

  it("uses watch as first argument after binary", () => {
    const plist = generatePlist(config);
    expect(plist).toContain(`<string>/home/user/repos/my-app/dist/repo-expert</string>\n\t\t<string>watch</string>`);
  });

  it("derives PATH from binary parent directory", () => {
    const plist = generatePlist(config);
    expect(plist).toContain("/home/user/repos/my-app/dist:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
  });

  it("includes interval, debounce, and config arguments", () => {
    const plist = generatePlist(config);
    expect(plist).toContain("<string>30</string>");
    expect(plist).toContain("<string>250</string>");
    expect(plist).toContain("<string>config.yaml</string>");
  });

  it("sets working directory", () => {
    const plist = generatePlist(config);
    expect(plist).toContain("<string>/home/user/repos/my-app</string>");
  });

  it("sets log path for stdout and stderr", () => {
    const plist = generatePlist(config);
    const logOccurrences = plist.split(config.logPath).length - 1;
    expect(logOccurrences).toBe(2);
  });
});
