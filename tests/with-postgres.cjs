"use strict";

const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");

async function run(command, args, options = {}) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  if (code !== 0) throw new Error(`Test command exited with status ${code}.`);
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function main() {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const directory = await mkdtemp(path.join(tmpdir(), "scanora-invites-postgres-"));
  const port = await unusedPort();
  const password = randomBytes(24).toString("hex");
  const postgres = new EmbeddedPostgres({
    databaseDir: path.join(directory, "db"), port, user: "postgres", password,
    persistent: true, authMethod: "scram-sha-256", initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-h", "127.0.0.1"]
  });
  // pg_ctl shuts down Windows workers cleanly; forced termination can orphan them.
  const pgCtl = process.platform === "win32" ? path.resolve(path.dirname(require.resolve("@embedded-postgres/windows-x64", {
    paths: [path.dirname(require.resolve("embedded-postgres"))]
  })), "..", "native", "bin", "pg_ctl.exe") : null;
  let started = false;
  let exitCode = 1;
  try {
    await postgres.initialise();
    if (pgCtl) {
      await run(pgCtl, ["start", "-D", path.join(directory, "db"), "-l", path.join(directory, "postgres.log"),
        "-o", `-h 127.0.0.1 -p ${port}`, "-w", "-t", "30"]);
    } else await postgres.start();
    started = true;
    const child = spawn(process.execPath, ["--test", "tests/database.test.cjs"], {
      cwd: path.join(__dirname, ".."), stdio: "inherit",
      env: { ...process.env, TEST_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres` }
    });
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    exitCode = code ?? 1;
  } finally {
    if (started) {
      if (pgCtl) await run(pgCtl, ["stop", "-D", path.join(directory, "db"), "-m", "fast", "-w", "-t", "30"]);
      else await postgres.stop();
    }
    await rm(directory, { recursive: true, force: true });
  }
  process.exitCode = exitCode;
}
main().catch((error) => { console.error("Local PostgreSQL tests failed:", error.message); process.exitCode = 1; });
