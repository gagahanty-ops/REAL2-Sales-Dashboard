---
name: real2-readonly-gate
description: Use before creating or changing amoCRM or Google Sheets integration code in the REAL2 dashboard.
---

# REAL2 Read-Only Gate

1. Read `SECURITY_READ_ONLY.md` and the relevant approved plan task.
2. List every outbound `(host, method, normalized path)` the change can produce.
3. Reject any amoCRM business method other than GET and any host other than `555151.amocrm.ru`.
4. For OAuth, allow POST only to exact path `/oauth2/access_token` and redact its request/response.
5. For Sheets, compare the ID to `PROTECTED_SPREADSHEET_IDS`, which must contain `123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks`, before constructing the Google client.
6. Require the environment and DB switch to be true before network access.
7. First write tests proving forbidden calls produce zero mock-server requests.
8. Run `pnpm test:security` and attach exact passing test names to the change summary.

Stop the task if any guard can be bypassed by user input, environment configuration, redirects, or an alternate HTTP client.
