import { z } from "zod";

const booleanFlag = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const tokenEncryptionKey = z.string().refine((value) => {
  const decoded = Buffer.from(value, "base64");
  return decoded.byteLength === 32 && decoded.toString("base64") === value;
});

const serverEnvSchema = z
  .object({
    APP_URL: z.url(),
    DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }),
    SUPABASE_URL: z.url(),
    SUPABASE_ANON_KEY: z.string().min(8),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(8),
    TRUSTED_PROXY_SECRET: z.string().min(32).optional(),
    AMO_CLIENT_ID: z.string().min(1),
    AMO_CLIENT_SECRET: z.string().min(8),
    AMO_REDIRECT_URI: z.url({ protocol: /^https$/ }),
    TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
    SYNC_ENABLED: booleanFlag,
    SHEET_PUBLISH_ENABLED: booleanFlag,
    /**
     * The manually created copy. It is optional because publication is
     * configured later, and it can never name the protected original: the
     * Google policy refuses that identifier whatever the environment says.
     */
    GOOGLE_TARGET_SPREADSHEET_ID: z
      .string()
      .regex(/^[A-Za-z0-9_-]{20,200}$/)
      .optional(),
    GOOGLE_SERVICE_ACCOUNT_EMAIL: z.email().max(254).optional(),
    /** PEM private key of the service account; supplied by a secret store. */
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().min(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.SHEET_PUBLISH_ENABLED) return;
    for (const key of [
      "GOOGLE_TARGET_SPREADSHEET_ID",
      "GOOGLE_SERVICE_ACCOUNT_EMAIL",
      "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    ] as const) {
      if (value[key] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Требуется, когда публикация включена",
        });
      }
    }
  });

const serverEnvKeys = [
  "APP_URL",
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TRUSTED_PROXY_SECRET",
  "AMO_CLIENT_ID",
  "AMO_CLIENT_SECRET",
  "AMO_REDIRECT_URI",
  "TOKEN_ENCRYPTION_KEY",
  "SYNC_ENABLED",
  "SHEET_PUBLISH_ENABLED",
  "GOOGLE_TARGET_SPREADSHEET_ID",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
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
