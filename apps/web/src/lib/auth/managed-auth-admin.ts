import type { Database } from "@real2/db";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ManagedAuthAdmin } from "./user-admin";

export class ManagedAuthProviderError extends Error {
  readonly code = "E_AUTH_PROVIDER" as const;

  constructor() {
    super("E_AUTH_PROVIDER");
    this.name = "ManagedAuthProviderError";
  }
}

export function createManagedAuthAdmin(
  supabase: SupabaseClient,
  db: Database,
): ManagedAuthAdmin {
  return {
    async createUser({ email, password }) {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (error || !data.user) throw new ManagedAuthProviderError();
      return { id: data.user.id };
    },

    async deleteUser(authUserId) {
      const { error } = await supabase.auth.admin.deleteUser(authUserId);
      if (error) throw new ManagedAuthProviderError();
    },

    async revokeSessions(authUserId) {
      const [tables] = await db<
        { sessions_exists: boolean; refresh_tokens_exists: boolean }[]
      >`
        select
          to_regclass('auth.sessions') is not null as sessions_exists,
          to_regclass('auth.refresh_tokens') is not null as refresh_tokens_exists
      `;

      if (!tables) throw new ManagedAuthProviderError();

      await db.begin(async (transaction) => {
        if (tables.sessions_exists) {
          await transaction`
            delete from auth.sessions where user_id = ${authUserId}
          `;
        }
        if (tables.refresh_tokens_exists) {
          await transaction`
            delete from auth.refresh_tokens where user_id = ${authUserId}
          `;
        }
      });
    },
  };
}
