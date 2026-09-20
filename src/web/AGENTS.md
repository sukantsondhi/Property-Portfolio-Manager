# Web-specific guidance

- The web app is an untrusted client. Never add Azure keys, API keys, connection strings, admin allowlists, or durable SAS URLs to source or Vite environment variables.
- Render capabilities according to the session role for UX, but rely on the API for enforcement.
- Preserve responsive layouts and keyboard-labelled form controls. Status must be conveyed by text as well as colour.
- Use the shared API client so the selected `x-organization-id` is consistently attached.
- Treat closed rental-year pages as read-only; documents may be downloaded only through the protected API flow.
- Revoke object URLs created for previews when components unmount or files change.
- Finance UI must use `src/lib/finance.ts`, which mirrors the authoritative API tenant/month ledger. Do not calculate expected rent by summing payment rows; update both implementations and parity tests when finance semantics change.
