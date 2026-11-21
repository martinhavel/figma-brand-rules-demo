# ADR 0001: Static demo dependency targets

Date: 2026-11-21  
Status: Implemented locally

## Decision

Target Node 22, `style-dictionary@5.8.0`, DTCG 2025.10,
and the split MCP TypeScript SDK
with `@modelcontextprotocol/server@2.4.0`. Do not start a new implementation
on legacy `@modelcontextprotocol/sdk@1.32.2`.

## Evidence

- Style Dictionary npm `latest` was `5.8.0` on 2026-11-21. Its exact registry
  metadata declares `engines.node: >=22.0.0`.
- The DTCG Format Module 2025.10 is the stable Final Community Group Report
  published 2025-10-28.
- The legacy monolith's npm metadata reports `1.32.2` as latest and describes
  it as a maintenance line; v2 is the current stable split package line.
- Exact read-only npm registry metadata for `@modelcontextprotocol/server@2.4.0`
  declares `engines.node: >=20`, dependencies `@modelcontextprotocol/core: 2.4.0`
  and `zod: ^4.2.0`, and no peer dependencies. Node 22 therefore satisfies
  both selected packages.
- Exact read-only npm registry metadata selected `zod@4.6.7`,
  `typescript@7.0.2`, and `@types/node@22.20.5`. TypeScript requires Node
  `>=16.20.0`; Node 22 satisfies it. `@types/node@22.20.5` depends on
  `undici-types~8.9.0`.

Primary sources:

- <https://www.npmjs.com/package/style-dictionary?activeTab=versions>
- <https://registry.npmjs.org/style-dictionary/5.8.0>
- <https://www.designtokens.org/TR/2025.10/format/>
- <https://www.npmjs.com/package/%40modelcontextprotocol/sdk?activeTab=versions>
- <https://registry.npmjs.org/%40modelcontextprotocol/server/2.4.0>
- <https://github.com/modelcontextprotocol/typescript-sdk/releases>

## Consequences and limits

The eventual implementation uses one registry for the ticket's exactly three
tool IDs because one metadata/handler source is the narrowest way to keep MCP
discovery and REST routing semantically identical; it must not create a second
transport-specific handler list.

The exact pinned manifest is:
`@modelcontextprotocol/server@2.4.0`, `zod@4.6.7`,
`style-dictionary@5.8.0`, `typescript@7.0.2`, and
`@types/node@22.20.5`, plus their lock-resolved transitives. Zod is pinned to
4.6.7 because the advisory for versions below 4.6.6 affects 4.2.0;
see <https://github.com/advisories/GHSA-mrhx-c7xc-m3w5>. Style Dictionary's
four moderate transitive findings are documented for later review: npm's
suggested downgrade to Style Dictionary 3 would violate this ticket's required
Style Dictionary 5 scope, so this narrow correction does not apply it. It permits
`npm --package-lock-only --ignore-scripts`, IOC/advisory review, then a
controlled `npm ci`; it does not authorize any additional direct package.

Style Dictionary documents DTCG support but its full 2025.10 support remains
in progress. Local tests prove the complete typography fixture and custom ASE
encoder; gradients, duration, and resolvers are outside scope. CI/client
interoperability beyond the local raw-stdio test remains unverified.
