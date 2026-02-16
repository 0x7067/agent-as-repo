export function buildOnboardPrompt(repoName: string): string {
  return [
    `I'm a new developer joining the team and need to understand the ${repoName} codebase.`,
    "Please give me a comprehensive onboarding walkthrough covering:",
    "",
    "1. **Architecture overview**: High-level structure, key directories, and how components connect",
    "2. **Key patterns and conventions**: Coding style, naming conventions, common patterns used",
    "3. **Getting started**: How to set up the development environment and run the project",
    "4. **Common workflows**: How to add a feature, fix a bug, write tests, and deploy",
    "5. **Key files to read first**: The most important files a new developer should understand",
    "",
    "Search your archival memory for relevant source files to support your explanations.",
  ].join("\n");
}
