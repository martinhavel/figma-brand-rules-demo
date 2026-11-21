# Tool contract and access boundary

This is the shared contract for a fictional brand demo. Claude is only a client
used to measure the eventual round trip. Coverage evidence is reported separately.

## One registry

The registry has exactly `get_tokens`, `get_rule`, and `check_color_pair`.
Each entry declares `id`, `inputSchema`, `outputSchema` (the envelope below),
`status`, and `handler`. All three initially have status `Preview`: the ticket
does not authorize a production service. MCP discovery and REST routing derive
from these entries, never from a second list of handlers.

All inputs are JSON objects with `additionalProperties: false`. `brand` is a
required nonempty string on every tool. Brand identifiers are exact and case
sensitive; no fallback, normalization, or default brand exists.

| ID | Additional input | Semantics |
| --- | --- | --- |
| `get_tokens` | Optional `mode` and `path`, both nonempty strings | Omitted mode selects that brand's documented default. Omitted path selects its whole token tree; a path selects a token or group in that tree. |
| `get_rule` | Exactly one of nonempty `rule_id` or `topic` | Return `rules: []` containing matching rules and their source citations; no match is `RULE_NOT_FOUND`. Never search other brands. |
| `check_color_pair` | Required nonempty `fg`, `bg`; required `text_size: "normal" \| "large"` | `fg` and `bg` are color token paths in the brand's default mode, not raw CSS colors or filenames. Return WCAG AA contrast verdict and separate brand-pair approval. |

Tool paths are dotted token paths such as `semantic.color.text`. They are
resolved in the selected in-memory brand tree, never interpolated into file
paths or URLs. A rule citation is a versioned source pointer to that brand's
rule JSON, with any supporting public standard URL. Every rule carries its
stable ID and `reason`.

## Authentication before data lookup

The local demo loads an explicit API-key-to-allowed-brands configuration from
its process environment. No key is hardcoded, generated into fixtures, committed,
returned by a tool, or written to logs. Empty/invalid configuration fails startup.
Unknown brands in an allowlist are configuration errors rather than a wildcard.
There are no wildcard permissions and no anonymous data calls.

REST receives exactly one `Authorization: Bearer <key>` header. Local MCP stdio
receives its key from the child process environment. A key is transport context,
never a model-visible tool argument. Discovery exposes schemas only, never
tokens, rules, configured key identities, or available brand inventories.

For each invocation the shared dispatcher:

1. Validates the credential against the configured key set without logging it.
2. Validates the tool input schema, including the required `brand`.
3. Checks the credential's exact brand allowlist before selecting a namespace.
4. Selects that brand's separate token tree and rule index and invokes the handler.

An unknown or unauthorized brand produces the same `BRAND_NOT_ALLOWED` code
and generic message. There is no global rule/token search or shared data index.
Successful authorization never permits a handler to fall back to another brand.
Runtime key comparisons use equal-length digests and constant-time
comparison; responses must not include submitted credentials or foreign data.
Denial and isolation evidence must cover the current build and both adapters.

## Envelope and transport parity

Success: `{ "ok": true, "data": { ... } }`.

Failure: `{ "ok": false, "error": { "code": "...", "message": "..." } }`.

Successful data includes the selected `brand` and package `version`; token and
contrast data also includes the actual resolved `mode`. No timestamps or random
identifiers enter tool results. The MCP structured result and JSON text content
carry the same envelope as the REST response body. A tool failure sets MCP
`isError: true`; JSON-RPC framing and HTTP status are outside payload parity.
Protocol failures before tool dispatch are transport errors, not claimed parity.

| Shared outcome | REST `POST /tools/:name` | MCP tool call |
| --- | --- | --- |
| Success | 200, success envelope | Success envelope |
| `UNAUTHORIZED` | 401, failure envelope | Failure envelope, `isError` |
| `BRAND_NOT_ALLOWED` | 403, failure envelope | Same failure envelope, `isError` |
| `INVALID_ARGUMENT` | 400, failure envelope | Same failure envelope when dispatched |
| `TOKEN_NOT_FOUND`, `RULE_NOT_FOUND`, `MODE_NOT_FOUND` | 404, failure envelope | Same failure envelope, `isError` |
| `TOOL_NOT_FOUND` | 404, failure envelope | Protocol handling may reject an unknown name before dispatch |
| `INTERNAL_ERROR` | 500, generic failure envelope | Generic failure envelope, `isError` |

Parity evidence must compare the three registered tools' successful envelopes
and shared failures after transport framing is removed. It must exercise an
authorized request and a denied brand through both actual adapters. Stack
traces, filesystem locations, configuration, and foreign identifiers never
appear in public failure messages.

## Contrast meaning

The minimum demo handles opaque sRGB color tokens. Unsupported color spaces or
translucent values produce `INVALID_ARGUMENT`; no undocumented background
composition is assumed. Resolve aliases within the authorized brand first.
Calculate relative luminance and `(Llighter + 0.05)/(Ldarker + 0.05)` using WCAG
2.1, retaining full precision for comparison. Normal AA text requires 4.5:1;
large AA text requires 3:1. The caller chooses the category; this tool does not
inspect a rendered page or verify actual font size/weight.

`pass` is the numerical WCAG contrast verdict. `brand_pair_allowed` separately
states whether the ordered token pair is listed by the brand's color-pair rule;
adequate contrast alone does not certify brand approval. Return `rule_id` for
the applicable stable contrast rule and evidence with the resolved token paths,
resolved sRGB values, mode, numerical ratio, threshold and `text_size`.

Source: [WCAG 2.1 contrast minimum](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html).

## Scope

No OAuth, governance engine, page checking, hosting, real brand/client data,
production deployment, or additional tools.
