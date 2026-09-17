import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const sourceExtension = /\.(?:c|m)?tsx?$/;
const testFile = /\.(?:test|spec)\.(?:c|m)?tsx?$/;
const ignoredDirectories = new Set([".git", ".next", "dist", "node_modules"]);

export type SourceViolation = Readonly<{
  file: string;
  pattern: string;
}>;

function repositoryPath(pathname: string): string {
  return relative(process.cwd(), pathname).split(sep).join("/");
}

async function collectTypeScriptFiles(pathname: string): Promise<string[]> {
  const metadata = await stat(pathname);
  if (metadata.isFile()) {
    return sourceExtension.test(pathname) && !testFile.test(pathname)
      ? [repositoryPath(pathname)]
      : [];
  }

  if (!metadata.isDirectory()) return [];

  const entries = await readdir(pathname, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !ignoredDirectories.has(entry.name))
      .map((entry) => collectTypeScriptFiles(resolve(pathname, entry.name))),
  );
  return nested.flat();
}

export async function listTypeScriptFiles(
  roots: readonly string[],
): Promise<string[]> {
  const files = await Promise.all(
    roots.map((root) => collectTypeScriptFiles(resolve(process.cwd(), root))),
  );
  return [...new Set(files.flat())].sort();
}

export async function findForbiddenPatterns(
  files: readonly string[],
  options: Readonly<{
    allowFiles?: readonly string[];
    patterns: readonly RegExp[];
    scopeMarker: RegExp;
  }>,
): Promise<SourceViolation[]> {
  const allowed = new Set(options.allowFiles ?? []);
  const violations: SourceViolation[] = [];

  for (const file of files) {
    if (allowed.has(file)) continue;

    const source = await readFile(resolve(process.cwd(), file), "utf8");
    options.scopeMarker.lastIndex = 0;
    if (!options.scopeMarker.test(`${file}\n${source}`)) continue;

    for (const pattern of options.patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(source)) {
        violations.push({ file, pattern: pattern.source });
      }
    }
  }

  return violations;
}
