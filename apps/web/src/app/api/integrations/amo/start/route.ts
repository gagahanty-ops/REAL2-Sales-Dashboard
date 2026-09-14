import { createOAuthState } from "@real2/db";

import { requireRole } from "../../../../../lib/auth/authorization";
import { requireUser } from "../../../../../lib/auth/require-user";
import { requireSameOrigin } from "../../../../../lib/http-security";
import { withRoute } from "../../../../../lib/http/route";
import { getDatabase, getServerEnv } from "../../../../../lib/server/runtime";

const AMO_AUTHORIZE_URL = "https://www.amocrm.ru/oauth";

export const POST = withRoute(async (request) => {
  const admin = requireRole(await requireUser(), ["admin"]);
  requireSameOrigin(request);
  const env = getServerEnv();
  const state = await createOAuthState(
    getDatabase(),
    admin.id,
    new Date(),
    "/settings/integrations/amo",
  );
  const authorizationUrl = new URL(AMO_AUTHORIZE_URL);
  authorizationUrl.searchParams.set("client_id", env.AMO_CLIENT_ID);
  authorizationUrl.searchParams.set("redirect_uri", env.AMO_REDIRECT_URI);
  authorizationUrl.searchParams.set("state", state.value);

  return { authorizationUrl: authorizationUrl.toString() };
});
