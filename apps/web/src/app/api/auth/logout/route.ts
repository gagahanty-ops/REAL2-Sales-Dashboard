import { requireSameOrigin } from "../../../../lib/http-security";
import { createRequestSupabaseClient } from "../../../../lib/supabase/server";

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const supabase = await createRequestSupabaseClient();
    await supabase.auth.signOut({ scope: "local" });
    return new Response(null, { status: 204 });
  } catch {
    return Response.json(
      { error: { code: "E_FORBIDDEN", message: "Запрос отклонён" } },
      { status: 403 },
    );
  }
}
