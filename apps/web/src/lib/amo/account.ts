import { AppError } from "@real2/domain";
import { z } from "zod";

export const AMO_BASE_URL = "https://555151.amocrm.ru";
export const AMO_SUBDOMAIN = "555151";

export const amoAccountSchema = z.object({
  id: z.number().int().positive(),
  subdomain: z.string().regex(/^[a-z0-9-]+$/),
});

export type AmoAccount = z.infer<typeof amoAccountSchema>;

export function assertAmoAccountBinding(
  account: AmoAccount,
  expectedAccountId?: number,
): void {
  if (
    account.subdomain !== AMO_SUBDOMAIN ||
    `${account.subdomain}.amocrm.ru` !== new URL(AMO_BASE_URL).hostname ||
    (expectedAccountId !== undefined && account.id !== expectedAccountId)
  ) {
    throw new AppError("E_CONFLICT", 409);
  }
}
