/** Deterministic policy: additions are minor; any removal or changed token/rule is major. */
export type Snapshot = { tokens: unknown; rules: unknown[] };
export type Change = {
  kind: "token" | "rule";
  path: string;
  change: "added" | "removed" | "changed";
};
const flatten = (
  value: unknown,
  prefix = "",
  out = new Map<string, string>(),
) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    "$value" in value
  ) {
    out.set(prefix, JSON.stringify(value));
    return out;
  }
  for (const [key, child] of Object.entries(value))
    flatten(child, prefix ? `${prefix}.${key}` : key, out);
  return out;
};
export function compareSnapshots(
  before: Snapshot,
  after: Snapshot,
): { version: "major" | "minor" | "patch"; changes: Change[] } {
  const changes: Change[] = [];
  const a = flatten(before.tokens);
  const b = flatten(after.tokens);
  for (const path of new Set([...a.keys(), ...b.keys()]))
    if (a.get(path) !== b.get(path))
      changes.push({
        kind: "token",
        path,
        change: !a.has(path) ? "added" : !b.has(path) ? "removed" : "changed",
      });
  const rules = (items: unknown[]) =>
    new Map(
      items.map((item) => [
        String((item as Record<string, unknown>).id),
        JSON.stringify(item),
      ]),
    );
  const ar = rules(before.rules);
  const br = rules(after.rules);
  for (const path of new Set([...ar.keys(), ...br.keys()]))
    if (ar.get(path) !== br.get(path))
      changes.push({
        kind: "rule",
        path,
        change: !ar.has(path) ? "added" : !br.has(path) ? "removed" : "changed",
      });
  return {
    version: changes.some((x) => x.change !== "added")
      ? "major"
      : changes.some((x) => x.change === "added")
        ? "minor"
        : "patch",
    changes,
  };
}
export function nextVersion(
  current: string,
  kind: "major" | "minor" | "patch",
  empty = false,
) {
  if (!/^\d+\.\d+\.\d+$/.test(current))
    throw new Error("currentSemver must be x.y.z");
  if (empty) return "0.1.0";
  const [major, minor, patch] = current.split(".").map(Number);
  return kind === "major"
    ? `${major + 1}.0.0`
    : kind === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;
}
export function markdownChangelog(
  current: string,
  before: Snapshot,
  after: Snapshot,
) {
  const diff = compareSnapshots(before, after);
  const version =
    diff.changes.length === 0
      ? current
      : nextVersion(current, diff.version, current === "0.0.0");
  return `## ${version}\n\n${
    diff.changes
      .map((change) => `- ${change.kind} ${change.change}: \`${change.path}\``)
      .sort()
      .join("\n") || "- No changes."
  }\n`;
}
