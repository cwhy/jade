// SPDX-License-Identifier: MPL-2.0
// Disposable SQLite model worker, deliberately one process per interaction.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Room } from "@cwhy/jade-testkit/peers";
import { validate } from "@cwhy/jade-core/admission";
const input = JSON.parse(readFileSync(0, "utf8")),
  db = new DatabaseSync(process.argv[2]);
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS model(id INTEGER PRIMARY KEY,payload TEXT NOT NULL)",
);
try {
  if (input.kind === "seed") {
    validate(input.state);
    const record = new Room(input.state).snapshot();
    db.prepare("INSERT INTO model VALUES(1,?)").run(JSON.stringify(record));
    console.log(JSON.stringify({ seeded: true }));
  } else {
    const record = JSON.parse(
      db.prepare("SELECT payload FROM model WHERE id=1").get().payload,
    );
    validate(record.state);
    const room = new Room(null, record);
    if (input.kind === "read") console.log(JSON.stringify(room.snapshot()));
    else if (input.kind === "submit") {
      const receipt = room.accept(input.op);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE model SET payload=? WHERE id=1").run(
          JSON.stringify(room.snapshot()),
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      if (input.crash) process.kill(process.pid, "SIGKILL");
      console.log(JSON.stringify({ receipt, record: room.snapshot() }));
    } else throw Error("Unknown worker command");
  }
} finally {
  db.close();
}
