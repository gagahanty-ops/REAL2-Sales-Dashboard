export type LogCapture = Readonly<{
  lines: string[];
  write(line: string): void;
  records(): Record<string, unknown>[];
}>;

export function createLogCapture(): LogCapture {
  const lines: string[] = [];

  return {
    lines,
    write(line) {
      lines.push(line);
    },
    records() {
      return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    },
  };
}
