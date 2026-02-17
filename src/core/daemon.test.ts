import { describe, it, expect } from "vitest";
import { generatePlist, PLIST_LABEL } from "./daemon.js";

describe("generatePlist", () => {
  const config = {
    workingDirectory: "/home/user/repos/my-app",
    pnpmPath: "/home/user/.local/share/mise/shims/pnpm",
    intervalSeconds: 30,
    configPath: "config.yaml",
    logPath: "/home/user/Library/Logs/repo-expert-watch.log",
  };

  it("contains the label", () => {
    const plist = generatePlist(config);
    expect(plist).toContain(`<string>${PLIST_LABEL}</string>`);
  });

  it("uses the provided pnpm path", () => {
    const plist = generatePlist(config);
    expect(plist).toContain("<string>/home/user/.local/share/mise/shims/pnpm</string>");
  });

  it("derives PATH from pnpm parent directory", () => {
    const plist = generatePlist(config);
    expect(plist).toContain("/home/user/.local/share/mise/shims:/usr/local/bin:/usr/bin:/bin");
  });

  it("includes interval and config arguments", () => {
    const plist = generatePlist(config);
    expect(plist).toContain("<string>30</string>");
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
