/** Extract leading issue number from a branch name like "42-fix-bug" */
export function extractIssueNumber(branch: string): number | null {
  const match = branch.match(/^(\d+)-/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/** Generate a branch name from an issue number and title */
export function issueToSlug(number: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
    .replace(/-$/, "");
  return `${number}-${slug}`;
}
