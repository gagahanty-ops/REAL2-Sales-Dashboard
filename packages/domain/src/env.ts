import { z } from "zod";

const booleanFlag = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const serverEnvSchema = z
  .object({
    APP_URL: z.url(),
    DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }),
    SUPABASE_URL: z.url(),
    SUPABASE_ANON_KEY: z.string().min(8),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(8),
    SYNC_ENABLED: booleanFlag,
    SHEET_PUBLISH_ENABLED: booleanFlag,
  })
  .strict();

const serverEnvKeys = [
  "APP_URL",
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SYNC_ENABLED",
  "SHEET_PUBLISH_ENABLED",
] as const;

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class ServerEnvValidationError extends Error {
  constructor(fields: readonly string[]) {
    super(`Invalid server configuration: ${fields.join(", ")}`);
    this.name = "ServerEnvValidationError";
  }
}

export function parseServerEnv(
  input: Record<string, string | undefined>,
): ServerEnv {
  const selectedInput = Object.fromEntries(
    serverEnvKeys.map((key) => [key, input[key]]),
  );
  const result = serverEnvSchema.safeParse(selectedInput);

  if (!result.success) {
    const fields = [
      ...new Set(
        result.error.issues.map((issue) => String(issue.path[0] ?? "environment")),
      ),
    ];

    throw new ServerEnvValidationError(fields);
  }

  return result.data;
}
