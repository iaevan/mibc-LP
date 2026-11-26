// Operations for the email campaign project only. Never touches ticket data.
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../worker/campaigns/shared.mjs";

const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const operation = process.argv[2];
const local = process.argv.includes("--local");
const db = "mibc-campaigns";
const configPath = resolve(
  root,
  local ? ".wrangler/campaign-local.json" : "wrangler.campaigns.jsonc",
);

function run(args, input) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
    });
    if (input !== undefined) child.stdin.end(input);
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? done() : reject(new Error(`Wrangler exited ${code}`)),
    );
  });
}
async function config() {
  return await readFile(resolve(root, "wrangler.campaigns.jsonc"), "utf8");
}
async function main() {
  if (operation === "local-config") {
    await mkdir(resolve(root, ".wrangler"), { recursive: true });
    // Keep a separate local DB identity. No remote commands accept this file.
    const source = await config();
    const base = source.replace(/^\s*\/\/[^\n]*$/gm, "");
    const value = JSON.parse(base);
    value.main = resolve(root, "worker/campaigns/local.mjs");
    value.assets = {
      binding: "ASSETS",
      directory: resolve(root, "out"),
      run_worker_first: ["/api/campaigns/*", "/admin", "/admin/*"],
      html_handling: "force-trailing-slash",
      not_found_handling: "404-page",
    };
    value.d1_databases = [
      {
        binding: "CAMPAIGN_DB",
        database_name: db,
        database_id: "00000000-0000-0000-0000-000000000001",
        migrations_dir: resolve(root, "campaign-migrations"),
      },
    ];
    delete value.kv_namespaces;
    delete value.account_id;
    await writeFile(
      resolve(root, ".wrangler/campaign-local.json"),
      JSON.stringify(value, null, 2),
    );
    console.log(
      "Local campaign configuration created. Ticket resources are not bound.",
    );
    return;
  }
  if (operation === "init") {
    const text = await config();
    if (text.includes('"binding": "CAMPAIGN_DB"')) {
      console.log("Campaign binding already exists.");
      return;
    }
    const child = spawn(process.execPath, [cli, "d1", "create", db,"--config",configPath], {
      cwd: root,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const completion = new Promise((done) => child.on("close", done));
    let output = "";
    for await (const chunk of child.stdout) {
      output += chunk;
      process.stdout.write(chunk);
    }
    const code = await completion;
    if (code !== 0)
      throw new Error(
        "Database creation denied. The website account needs D1 permission.",
      );
    const id =
      output.match(/"database_id"\s*:\s*"([a-f0-9-]{36})"/)?.[1] ||
      output.match(/database_id\s*=\s*"([a-f0-9-]{36})"/)?.[1];
    if (!id)
      throw new Error(
        "Database created; copy its ID into a CAMPAIGN_DB binding in wrangler.campaigns.jsonc. Do not create another database.",
      );
    const value=JSON.parse(text);
    value.d1_databases.push({
        binding: "CAMPAIGN_DB",
        database_name: db,
        database_id: id,
        migrations_dir: "campaign-migrations",
      });
    await writeFile(
      resolve(root, "wrangler.campaigns.jsonc"),
      JSON.stringify(value,null,2),
    );
    console.log(
      "Campaign binding added. Apply campaign migrations, then commit this configuration.",
    );
    return;
  }
  if (operation === "migrate") {
    await run([
      "d1",
      "migrations",
      "apply",
      db,
      local ? "--local" : "--remote",
      "--config",
      configPath,
    ]);
    return;
  }
  if (operation === "user") {
    if (process.stdin.isTTY)
      throw new Error(
        'Pass {"username":"...","password":"..."} as JSON over standard input. Do not put passwords in command arguments.',
      );
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const { username, password } = JSON.parse(input);
    if (
      !/^[^\s@]+@nsumibc\.online$/.test(username) ||
      typeof password !== "string" ||
      password.length < 8
    )
      throw new Error(
        "Use an nsumibc.online address and a password of at least 8 characters.",
      );
    const hash = await hashPassword(password),
      file = resolve(root, `.wrangler/campaign-account-${randomUUID()}.sql`);
    const quote = (text) => `'${text.replaceAll("'", "''")}'`;
    await mkdir(resolve(root, ".wrangler"), { recursive: true });
    await writeFile(
      file,
      `INSERT INTO admins(username,password_hash) VALUES(${quote(username.toLowerCase())},${quote(hash)}) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash;\nDELETE FROM admin_sessions WHERE username=${quote(username.toLowerCase())};`,
    );
    try {
      await run([
        "d1",
        "execute",
        db,
        local ? "--local" : "--remote",
        "--config",
        configPath,
        "--file",
        file,
      ]);
    } finally {
      await unlink(file);
    }
    console.log(
      "Campaign account saved; existing sessions for it were revoked.",
    );
    return;
  }
  throw new Error(
    "Usage: node scripts/campaigns.mjs local-config | init | migrate [--local] | user [--local]",
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
