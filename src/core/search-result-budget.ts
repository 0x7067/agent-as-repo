export interface SearchResult {
  id: string;
  text: string;
  score: number;
}

export interface BudgetedSearchResult extends SearchResult {
  filePath: string | null;
  truncated: boolean;
}

export interface SearchResultBudget {
  limit: number;
  maxTextChars: number;
  maxPerFile: number;
}

const CONTINUED_SUFFIX = " (continued)";

function passageFilePath(text: string): string | null {
  const firstLine = text.split("\n", 1)[0] ?? "";
  if (!firstLine.startsWith("FILE: ")) return null;
  const pathAndMetadata = firstLine.slice("FILE: ".length);
  const separator = pathAndMetadata.indexOf(" | ");
  let filePath = (separator === -1
    ? pathAndMetadata
    : pathAndMetadata.slice(0, separator)).trim();
  if (filePath.endsWith(CONTINUED_SUFFIX)) {
    filePath = filePath.slice(0, -CONTINUED_SUFFIX.length).trimEnd();
  }
  return filePath.length > 0 ? filePath : null;
}

function truncateText(text: string, maxChars: number): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= maxChars) return { text, truncated: false };
  if (maxChars <= 1) return { text: "…".slice(0, maxChars), truncated: true };
  return { text: `${text.slice(0, maxChars - 1)}…`, truncated: true };
}

/** Select high-ranked, file-diverse passages within a strict output budget. */
export function budgetSearchResults(
  results: SearchResult[],
  budget: SearchResultBudget,
): BudgetedSearchResult[] {
  const selected: BudgetedSearchResult[] = [];
  const perFileCounts = new Map<string, number>();

  for (const result of results) {
    if (selected.length >= budget.limit) break;
    const filePath = passageFilePath(result.text);
    const diversityKey = filePath ?? `passage:${result.id}`;
    const currentCount = perFileCounts.get(diversityKey) ?? 0;
    if (currentCount >= budget.maxPerFile) continue;

    const truncated = truncateText(result.text, budget.maxTextChars);
    selected.push({
      id: result.id,
      score: result.score,
      filePath,
      text: truncated.text,
      truncated: truncated.truncated,
    });
    perFileCounts.set(diversityKey, currentCount + 1);
  }

  return selected;
}
