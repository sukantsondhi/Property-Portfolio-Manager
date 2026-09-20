# Contributing

Thanks for helping improve Property Portfolio Manager. Browse existing issues before opening a new one, and keep reports free of real tenant, property, authentication and Azure data. For a security issue, use [private vulnerability reporting](SECURITY.md) instead of a public issue.

## Make a change

1. Open an issue for a substantial change, especially one that affects data shape, authorisation, accounting, email frequency or Azure cost. Describe the user problem and expected behaviour.
2. Fork the repository and create a topic branch. Use Node.js 22 or newer; run `npm ci` at the root. Copy `src/api/local.settings.example.json` to the ignored `src/api/local.settings.json` for local API work. The example uses only local dummy values.
3. Read `AGENTS.md` and the nearest nested guidance in `src/api` or `src/web`. API validation and authorisation are the security boundary; React checks are only presentation. Keep Cosmos operations partition-scoped, Blob access private, and money in integer pence.
4. Add a focused test for behaviour that could regress, particularly permissions, cross-property links, month attribution, finance parity or email selection. Keep `src/api/src/services/finance.ts` and `src/web/src/lib/finance.ts` aligned.
5. Run `npm run typecheck`, `npm test`, `npm run build` and `npm audit --audit-level=moderate`. If Bicep changed, run `az bicep build --file infra/main.bicep` and review cost/security effects in the PR.
6. Open a pull request explaining what changed, why, test results and any Azure cost or migration implications. Use synthetic fixtures and screenshots only. A maintainer reviews before merging to `main`.

The CI workflow checks pull requests without deployment secrets. Deployment credentials are reserved for the protected `main` workflow. Do not add a `pull_request_target` build of contributor code or expose secrets to forked pull requests.

## Style and compatibility

- Use UK English in UI copy, ISO dates and GBP/pence for stored money.
- Keep old schemaless Cosmos records readable where possible. Document any migration before changing relationships.
- Do not add a paid Azure service, SKU or background job without a cost and security review.
- Do not include real admin emails, subscription IDs, hostnames, keys, SAS URLs, private deployment plans or customer data in the repository.
- Keep screenshots made from synthetic data and verify they do not include local account identifiers or browser extensions.

By contributing, you agree that your contribution is distributed under this repository’s [MIT licence](LICENSE).
