import { closeDbClient } from "@real2/db";
import { z } from "zod";

import {
  bootstrapFirstAdmin,
  BootstrapAdminError,
} from "../apps/web/src/lib/auth/bootstrap-admin";
import { createManagedAuthAdmin } from "../apps/web/src/lib/auth/managed-auth-admin";
import { createManagedUser } from "../apps/web/src/lib/auth/user-admin";
import { getDatabase, getServerEnv } from "../apps/web/src/lib/server/runtime";
import { createAdminSupabaseClient } from "../apps/web/src/lib/supabase/server";

const bootstrapEnvSchema = z.object({
  BOOTSTRAP_ADMIN_EMAIL: z.email().max(254),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(512),
  BOOTSTRAP_ADMIN_FULL_NAME: z.string().trim().min(2).max(120),
});

async function main(): Promise<void> {
  getServerEnv();
  const input = bootstrapEnvSchema.parse(process.env);
  const db = getDatabase();
  const auth = createManagedAuthAdmin(createAdminSupabaseClient(), db);

  try {
    const user = await bootstrapFirstAdmin(
      {
        email: input.BOOTSTRAP_ADMIN_EMAIL,
        password: input.BOOTSTRAP_ADMIN_PASSWORD,
        fullName: input.BOOTSTRAP_ADMIN_FULL_NAME,
      },
      {
        async hasAdmin() {
          const [row] = await db<{ exists: boolean }[]>`
            select exists(
              select 1 from public.app_users
              where role = 'admin' and is_active
            ) as exists
          `;
          return row?.exists ?? false;
        },
        create(adminInput) {
          return createManagedUser(db, auth, adminInput);
        },
      },
    );

    process.stdout.write(`Первичный администратор создан: ${user.id}\n`);
  } finally {
    await closeDbClient(db);
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof BootstrapAdminError
      ? error.message
      : "Не удалось создать первичного администратора";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
