import { requireUser } from "../../../lib/auth/require-user";
import { withRoute } from "../../../lib/http/route";

export const GET = withRoute(async () => requireUser());
