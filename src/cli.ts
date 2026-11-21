import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { markdownChangelog, type Snapshot } from "./changelog.js";
import { buildBrandArtifacts } from "./pipeline.js";
const run = async () => {
  if (process.argv[2] === "pipeline") {
    const snapshots: Record<string, unknown> = {};
    const rules: unknown[] = [];
    for (const [brand, mode] of [
      ["alpha", "light"],
      ["alpha", "dark"],
      ["beta", "default"],
      ["gamma", "default"],
    ] as const) {
      const artifact = await buildBrandArtifacts(brand, mode);
      const dir = join("artifacts", brand, mode);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "tokens.css"), artifact.css);
      writeFileSync(
        join(dir, "tokens.json"),
        JSON.stringify(artifact.serverJson, null, 2),
      );
      writeFileSync(join(dir, "swatches.ase"), artifact.ase);
      writeFileSync(
        join(dir, "dtcg.json"),
        JSON.stringify(artifact.dtcg, null, 2),
      );
      snapshots[`${brand}/${mode}`] = artifact.serverJson.tokens;
      rules.push(...artifact.serverJson.rules);
    }
    writeFileSync(
      "artifacts/snapshot.json",
      JSON.stringify({ tokens: snapshots, rules }, null, 2),
    );
    return;
  }
  if (process.argv[2] === "changelog") {
    const [beforeFile, afterFile, current = "0.0.0"] = process.argv.slice(3);
    if (!beforeFile || !afterFile)
      throw new Error(
        "Usage: changelog before.json after.json [currentSemver]",
      );
    const before = JSON.parse(readFileSync(beforeFile, "utf8")) as Snapshot;
    const after = JSON.parse(readFileSync(afterFile, "utf8")) as Snapshot;
    process.stdout.write(markdownChangelog(current, before, after));
    return;
  }
  throw new Error(
    "Usage: cli pipeline | cli changelog before.json after.json [currentSemver]",
  );
};
void run();
