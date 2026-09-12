import { requireUser, SessionAccessError } from "../../../lib/auth/require-user";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ data: await requireUser() });
  } catch (error) {
    if (error instanceof SessionAccessError) {
      return Response.json(
        { error: { code: error.code, message: "Доступ запрещён" } },
        { status: error.status },
      );
    }

    return Response.json(
      { error: { code: "E_INTERNAL", message: "Внутренняя ошибка" } },
      { status: 500 },
    );
  }
}
