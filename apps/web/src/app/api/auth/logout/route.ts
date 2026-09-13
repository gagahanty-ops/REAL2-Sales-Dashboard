import { requireSameOrigin } from "../../../../lib/http-security";
import { requireUser } from "../../../../lib/auth/require-user";
import { withRoute } from "../../../../lib/http/route";
import { createRequestSupabaseClient } from "../../../../lib/supabase/server";

export const POST = withRoute(async (request) => {
  requireSameOrigin(request);
  await requireUser();
  const supabase = await createRequestSupabaseClient();
  await supabase.auth.signOut({ scope: "local" });
  return new Response(null, { status: 204 });
});
