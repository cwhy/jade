// SPDX-License-Identifier: MPL-2.0
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkBoundaries } from "./check-boundaries.mjs";
export function pack(root, destination) {
  checkBoundaries(root);
  mkdirSync(destination, { recursive: true });
  const artifacts = [];
  for (const folder of readdirSync(path.join(root, "packages")).sort()) {
    const dir = path.join(root, "packages", folder),
      pkg = JSON.parse(readFileSync(path.join(dir, "package.json")));
    if (!pkg.private) throw Error("Private package required");
    if (
      pkg.license !== "MPL-2.0" ||
      readFileSync(path.join(dir, "LICENSE"), "utf8") !==
        readFileSync(path.join(root, "LICENSE"), "utf8")
    )
      throw Error("Missing or inconsistent MPL license");
    const r = spawnSync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", destination],
      { cwd: dir, encoding: "utf8" },
    );
    if (r.status !== 0) throw Error(r.stderr || "Packing failed");
    const info = JSON.parse(r.stdout)[0];
    if (!info.files.some((file) => file.path === "LICENSE"))
      throw Error("Package omitted LICENSE");
    artifacts.push({
      name: pkg.name,
      version: pkg.version,
      filename: info.filename,
      integrity: info.integrity,
    });
  }
  writeFileSync(
    path.join(destination, "package-set.json"),
    JSON.stringify(artifacts, null, 2) + "\n",
  );
  return artifacts;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  console.log(
    JSON.stringify(
      pack(
        root,
        path.resolve(
          process.env.JADE_PACK_DIR || path.join(root, "artifacts/packages"),
        ),
      ),
      null,
      2,
    ),
  );
}
