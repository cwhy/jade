// SPDX-License-Identifier: MPL-2.0
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

export function files(root) {
  return readdirSync(root).flatMap((name) => {
    const p = path.join(root, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

// This is a narrow source dependency check, supplemented by actual Node import
// resolution and both bundle graphs. It is not a general JavaScript parser.
export function checkBoundaries(root) {
  const release = JSON.parse(readFileSync(path.join(root, "package.json")));
  const packages = new Map();
  for (const directory of readdirSync(path.join(root, "packages"))) {
    const dir = path.join(root, "packages", directory);
    const manifest = JSON.parse(readFileSync(path.join(dir, "package.json")));
    packages.set(manifest.name, { dir, manifest });
  }
  const edges = [];
  for (const [name, { dir, manifest }] of packages) {
    assert.equal(
      manifest.private,
      true,
      "Registry publication is a separate release step",
    );
    assert.equal(manifest.version, release.version);
    assert.equal(manifest.license, release.license);
    assert.ok(
      !Object.keys(manifest.exports).some((x) => x.includes("*")),
      "No private wildcard exports",
    );
    for (const target of Object.values(manifest.exports))
      assert.ok(existsSync(path.join(dir, target)), target);
    for (const f of files(path.join(dir, "src")).filter((f) =>
      f.endsWith(".js"),
    )) {
      const source = readFileSync(f, "utf8");
      const code = source.replace(/^\s*\/\/.*$/gm, "");
      assert.ok(
        !/\b(?:window|localStorage|indexedDB|WebSocket|fetch)\b/.test(code) ||
          name === "@cwhy/jade-browser",
        f,
      );
      if (name !== "@cwhy/jade-browser")
        assert.ok(!/\.createElement\(|\.ownerDocument\b/.test(code), f);
      assert.ok(!source.includes("feasibility/"), f);
      for (const m of source.matchAll(
        /(?:^\s*(?:import|export)\b[^;]*?\bfrom\s*|\bimport\s*\()(['"])([^'"]+)\1/gm,
      )) {
        const spec = m[2];
        if (spec.startsWith(".")) {
          const target = path.resolve(path.dirname(f), spec);
          assert.ok(
            target.startsWith(dir + path.sep),
            "Relative import escapes package: " + f + " " + spec,
          );
          assert.ok(existsSync(target), target);
          continue;
        }
        const dep = spec.split("/").slice(0, 2).join("/");
        assert.ok(
          packages.has(dep),
          "Undeclared platform/external dependency: " + spec,
        );
        assert.equal(
          manifest.dependencies[dep],
          release.version,
          name + " → " + dep,
        );
        const sub = spec === dep ? "." : "." + spec.slice(dep.length);
        assert.ok(
          packages.get(dep).manifest.exports[sub],
          "Private import: " + spec,
        );
        edges.push([name, dep]);
      }
    }
  }
  function visit(name, stack = []) {
    assert.ok(
      !stack.includes(name),
      "Package cycle: " + [...stack, name].join(" → "),
    );
    for (const [, dep] of edges.filter(([origin]) => origin === name))
      visit(dep, [...stack, name]);
  }
  for (const name of packages.keys()) visit(name);
  assert.ok(
    !edges.some(
      ([a, b]) => a !== "@cwhy/jade-testkit" && b === "@cwhy/jade-testkit",
    ),
  );
  assert.ok(
    !edges.some(
      ([a]) => a === "@cwhy/jade-core" || a === "@cwhy/jade-protocol",
    ),
  );
  return {
    packages: packages.size,
    sourceFiles: [...packages.values()].flatMap((x) =>
      files(path.join(x.dir, "src")),
    ).length,
    edges: [...new Set(edges.map((x) => x.join(" → ")))],
  };
}

export function checkBundle(meta, kind) {
  const inputs = Object.keys(meta.inputs);
  const helpers = inputs.filter((p) => p.endsWith("/model/immutable.js"));
  assert.equal(
    helpers.length,
    1,
    "One immutable certificate authority per runtime",
  );
  assert.ok(
    !inputs.some((p) => /feasibility\/|independent-(v2|origin|list)/.test(p)),
    "No lab-source aliases",
  );
  if (kind === "browser")
    assert.ok(
      !inputs.some(
        (p) =>
          p.endsWith("/collaboration/src/room.js") ||
          p.includes("/apps/lab/server/"),
      ),
    );
  else
    assert.ok(
      !inputs.some(
        (p) => p.includes("/browser/") || p.includes("/editor-browser/"),
      ),
    );
  return { inputs: inputs.length, immutableAuthority: helpers[0] };
}

export function checkInstalled(consumer, names) {
  for (const name of names) {
    const dir = path.join(consumer, "node_modules", name);
    assert.equal(
      realpathSync(dir),
      path.join(realpathSync(consumer), "node_modules", name),
      "Packed consumers must not use workspace symlinks",
    );
  }
}
