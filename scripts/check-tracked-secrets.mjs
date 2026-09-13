import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function isExample(path) {
  return /(?:^|[._-])example(?:[._-]|$)/i.test(path);
}

function isEnvironmentExample(name) {
  return /^\.env(?:\.[a-z0-9_-]+)*\.example$/i.test(name);
}

export function findForbiddenTrackedPaths(paths) {
  return paths.filter((path) => {
    const lower = path.toLowerCase();
    const name = lower.split("/").at(-1) ?? lower;

    if (/^\.env(?:\.|$)/.test(name) && !isEnvironmentExample(name)) return true;
    if (/\.(?:pem|key)$/.test(name)) return true;
    if (isExample(lower)) return false;
    if (/oauth.*\.json$/.test(name)) return true;
    return /service[-_.]?account.*\.json$/.test(name);
  });
}

function main() {
  const result = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write("Не удалось проверить отслеживаемые Git-файлы\n");
    process.exitCode = 1;
    return;
  }

  const forbidden = findForbiddenTrackedPaths(
    result.stdout.split("\0").filter(Boolean),
  );
  if (forbidden.length === 0) return;

  process.stderr.write(
    `Запрещённые файлы с возможными секретами:\n${forbidden.join("\n")}\n`,
  );
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
