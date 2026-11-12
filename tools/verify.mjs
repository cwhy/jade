// SPDX-License-Identifier: MPL-2.0
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  cpSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { pack } from "./pack.mjs";
import { checkBoundaries, checkInstalled } from "./check-boundaries.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(path.join(root, "artifacts"), { recursive: true });
const output =
  process.env.JADE_OUTPUT ||
  mkdtempSync(path.join(root, "artifacts", "verify-"));
mkdirSync(output, { recursive: true });
const consumer = path.join(output, "consumer"),
  tarballs = path.join(output, "tarballs");
mkdirSync(consumer);
function run(command, args, cwd, label) {
  const r = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  writeFileSync(path.join(output, label + ".log"), r.stdout + "\n" + r.stderr);
  assert.equal(r.status, 0, `${label} failed; see ${output}/${label}.log`);
  return r.stdout;
}
const boundary = checkBoundaries(root);
const internal = run(
  process.execPath,
  [
    "--test",
    ...readdirSync(path.join(root, "tests"))
      .filter((x) => x.endsWith(".test.mjs"))
      .map((x) => "tests/" + x),
  ],
  root,
  "internal",
);
const artifacts = pack(root, tarballs);
writeFileSync(
  path.join(consumer, "package.json"),
  JSON.stringify({
    name: "engine-external-consumer",
    private: true,
    type: "module",
  }),
);
run(
  "npm",
  [
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    ...artifacts.map((x) => path.join(tarballs, x.filename)),
  ],
  consumer,
  "install",
);
checkInstalled(
  consumer,
  artifacts.map((x) => x.name),
);
cpSync(path.join(root, "contracts"), path.join(consumer, "contracts"), {
  recursive: true,
});
cpSync(path.join(root, "examples"), path.join(consumer, "examples"), {
  recursive: true,
});
run(process.execPath, ["examples/basic-editing.mjs"], consumer, "example");
const scope = JSON.parse(
  readFileSync(path.join(root, "verification/test-scope.json")),
);
for (const name of scope.included_test_roots) {
  assert.equal(path.basename(name),name,'Contract inventory entries must be filenames');
  assert.ok(existsSync(path.join(consumer,'contracts',name)),'Missing contract root: '+name);
}
const contracts = run(
  process.execPath,
  ["--test", ...scope.included_test_roots.map((x) => "contracts/" + x)],
  consumer,
  "contracts",
);
function passed(log) {
  const m = log.match(/(?:ℹ|#) pass (\d+)/);
  assert.ok(m, "Missing test count");
  return Number(m[1]);
}
const result = {
  status: "PASS",
  scope: "Standalone jade contracts, not full product qualification",
  output,
  internalPass: passed(internal),
  contractPass: passed(contracts),
  contractRoots: scope.included_test_roots.length,
  externalAppTestRoots: scope.external_test_roots.length,
  boundary,
  artifacts,
  workspaceSymlinks: false,
};
writeFileSync(
  path.join(output, "result.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
