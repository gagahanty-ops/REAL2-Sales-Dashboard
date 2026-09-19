#!/usr/bin/env node
import { readFile } from "node:fs/promises";

/**
 * Refuses a deployment file that would enable an external write or name the
 * protected spreadsheet. It prints findings only: no secret value is ever read
 * or echoed.
 */
const PROTECTED_SPREADSHEET_ID = "123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks";

const FORBIDDEN = [
  { pattern: /SYNC_ENABLED\s*[:=]\s*["']?true/i, reason: "включает синхронизацию" },
  {
    pattern: /SHEET_PUBLISH_ENABLED\s*[:=]\s*["']?true/i,
    reason: "включает публикацию в Google Sheets",
  },
  { pattern: new RegExp(PROTECTED_SPREADSHEET_ID), reason: "содержит защищённую таблицу" },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, reason: "содержит приватный ключ" },
  { pattern: /postgres(?:ql)?:\/\/[^\s"']*:[^\s"'@]+@/i, reason: "содержит пароль базы" },
];

const REQUIRED = [
  { pattern: /read_only:\s*true/, reason: "контейнеры должны быть read-only" },
  { pattern: /no-new-privileges:true/, reason: "нужен запрет повышения привилегий" },
  { pattern: /env_file:/, reason: "секреты подключаются файлом, а не в compose" },
];

async function main() {
  const [path] = process.argv.slice(2);
  if (!path) {
    process.stderr.write("usage: check-deployment-config.mjs <compose file>\n");
    process.exitCode = 1;
    return;
  }

  const content = await readFile(path, "utf8");
  const problems = [];
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(content)) problems.push(`запрещено: ${rule.reason}`);
  }
  for (const rule of REQUIRED) {
    if (!rule.pattern.test(content)) problems.push(`отсутствует: ${rule.reason}`);
  }

  if (problems.length > 0) {
    for (const problem of problems) process.stdout.write(`${problem}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("deployment configuration is safe\n");
}

await main();
