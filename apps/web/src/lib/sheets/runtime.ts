import { createGoogleSheetClient, type SheetClientFactory } from "@real2/integrations";
import { AppError } from "@real2/domain";

import { getServerEnv } from "../server/runtime";
import type { SheetSecrets } from "./target-service";

/**
 * Reads the service account from the server configuration. In production the
 * values come from a secret store; nothing is cached on disk and nothing is
 * logged.
 */
export function sheetSecrets(): SheetSecrets {
  return {
    async readGoogleServiceAccount() {
      const env = getServerEnv();
      if (
        env.GOOGLE_SERVICE_ACCOUNT_EMAIL === undefined
        || env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY === undefined
      ) {
        throw new AppError("E_CONFIG_INCOMPLETE", 409);
      }
      return {
        clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        privateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/gu, "\n"),
      };
    },
  };
}

export function sheetClientFactory(): SheetClientFactory {
  return (credentials, spreadsheetId, options) =>
    createGoogleSheetClient(credentials, spreadsheetId, { access: options.access });
}
