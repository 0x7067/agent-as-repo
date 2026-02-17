export function buildOnboardPrompt(repoName: string): string {
  return [
    `I'm a new developer joining the team and need to understand the ${repoName} codebase.`,
    "Please give me a structured onboarding walkthrough with concrete evidence from archival memory.",
    "",
    "1. **Architecture overview**: high-level structure, key directories, and how components connect",
    "2. **Key patterns and conventions**: coding style, naming conventions, and common patterns",
    "3. **Getting started**: how to set up the development environment and run the project",
    "4. **Common workflows**: how to add a feature, fix a bug, write tests, and deploy",
    "5. **Top 10 files to read first** with short reasons and file references",
    "6. **Day-1 checklist**: concrete steps a new developer should execute in order",
    "7. **Unknowns and assumptions**: what is uncertain and what assumptions were made",
    "8. **Confidence**: high/medium/low for each major section",
    "",
    "Use file references in this format: `path/to/file.ts`.",
    "If you cannot find evidence for a claim, say so explicitly instead of guessing.",
    "Search your archival memory for relevant source files to support every section.",
  ].join("\n");
}
