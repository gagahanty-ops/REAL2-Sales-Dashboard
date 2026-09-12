# Rule: external systems fail closed

- amoCRM business paths are called only through `amoFetch`, with exact host, method, and normalized-path allowlists.
- No generic proxy, raw URL from a request, browser-side token, or direct amoCRM `fetch` is permitted.
- Google writer compares the target against the immutable protected-ID denylist containing `123QVhKGG3Y6ZlyHYnuKG_1BPhS82FcYaqY96nsB7Iks` before client creation.
- Both environment and database switches must be true before any sync or publication network call.
- Upstream 401/429/5xx, schema mismatch, pagination loop, layout drift, or checksum mismatch leaves the last approved snapshot/publication intact.
- Audit logs contain method, normalized path, status, duration, attempt, result, and trace ID only.
