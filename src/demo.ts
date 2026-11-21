import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { AccessError, bearerCredential, createAuthorizer } from "./auth.js";
import {
  buildBrandArtifacts,
  PACKAGE_VERSION,
  type PipelineArtifacts,
} from "./pipeline.js";

export type Envelope =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string } };
export class DemoError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const brands = ["alpha", "beta", "gamma"] as const;
const defaults: Record<(typeof brands)[number], string> = {
  alpha: "light",
  beta: "default",
  gamma: "default",
};
const base = { brand: z.string().min(1) };
const outputShape = z.object({
  ok: z.boolean(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
}).strict();
type ToolId = "get_tokens" | "get_rule" | "check_color_pair";
const lookup = (brand: string, mode: string) => `${brand}:${mode}`;
const own = (tree: unknown, path: string): unknown => {
  let value: unknown = tree;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, part))
      throw new DemoError("TOKEN_NOT_FOUND", "Token not found.");
    value = (value as Record<string, unknown>)[part];
  }
  return value;
};
const failure = (error: unknown): Envelope =>
  error instanceof DemoError || error instanceof AccessError
    ? { ok: false, error: { code: error.code, message: error.message } }
    : {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "Internal error." },
      };
const color = (token: unknown): number[] => {
  const c = (
    token as {
      $value?: { colorSpace?: string; components?: unknown[]; alpha?: unknown };
    }
  ).$value;
  if (
    !c ||
    c.colorSpace !== "srgb" ||
    c.alpha !== 1 ||
    !Array.isArray(c.components) ||
    c.components.length !== 3 ||
    !c.components.every(Number.isFinite)
  )
    throw new DemoError(
      "INVALID_ARGUMENT",
      "Only opaque sRGB colors are supported.",
    );
  return c.components as number[];
};
export const contrastRatio = (a: number[], b: number[]) => {
  const l = (rgb: number[]) => {
    const x = rgb.map((v) =>
      v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2];
  };
  return (Math.max(l(a), l(b)) + 0.05) / (Math.min(l(a), l(b)) + 0.05);
};
export const registry = [
  {
    id: "get_tokens" as const,
    inputSchema: z
      .object({
        ...base,
        mode: z.string().min(1).optional(),
        path: z.string().min(1).optional(),
      })
      .strict(),
    outputSchema: outputShape,
    status: "Preview" as const,
    handler: (
      input: { brand: string; mode?: string; path?: string },
      artifact: PipelineArtifacts,
      mode: string,
    ): Envelope => {
      const tokens = input.path
        ? own(artifact.serverJson.tokens, input.path)
        : artifact.serverJson.tokens;
      return {
        ok: true,
        data: {
          brand: input.brand,
          version: PACKAGE_VERSION,
          mode,
          ...(input.path ? { token: tokens } : { tokens }),
        },
      };
    },
  },
  {
    id: "get_rule" as const,
    inputSchema: z
      .object({
        ...base,
        rule_id: z.string().min(1).optional(),
        topic: z.string().min(1).optional(),
      })
      .strict()
      .refine(
        (v) => Boolean(v.rule_id) !== Boolean(v.topic),
        "exactly one selector",
      ),
    outputSchema: outputShape,
    status: "Preview" as const,
    handler: (
      input: { brand: string; rule_id?: string; topic?: string },
      artifact: PipelineArtifacts,
    ): Envelope => {
      const rules = artifact.serverJson.rules.filter((rule) => {
        const r = rule as Record<string, unknown>;
        return input.rule_id
          ? r.id === input.rule_id
          : r.id === `${input.brand}.${input.topic}` ||
              String(r.id).includes(input.topic!);
      });
      if (!rules.length)
        throw new DemoError("RULE_NOT_FOUND", "Rule not found.");
      return {
        ok: true,
        data: { brand: input.brand, version: PACKAGE_VERSION, rules },
      };
    },
  },
  {
    id: "check_color_pair" as const,
    inputSchema: z
      .object({
        ...base,
        fg: z.string().min(1),
        bg: z.string().min(1),
        text_size: z.enum(["normal", "large"]),
      })
      .strict(),
    outputSchema: outputShape,
    status: "Preview" as const,
    handler: (
      input: {
        brand: string;
        fg: string;
        bg: string;
        text_size: "normal" | "large";
      },
      artifact: PipelineArtifacts,
      mode: string,
    ): Envelope => {
      const fg = color(own(artifact.serverJson.tokens, input.fg));
      const bg = color(own(artifact.serverJson.tokens, input.bg));
      const value = contrastRatio(fg, bg);
      const threshold = input.text_size === "normal" ? 4.5 : 3;
      const rule = artifact.serverJson.rules
        .map((x) => x as Record<string, unknown>)
        .find((x) => String(x.id).endsWith(".contrast.aa"));
      const allowed =
        Array.isArray(rule?.allowedColorPairs) &&
        rule.allowedColorPairs.some(
          (x) =>
            x &&
            typeof x === "object" &&
            (x as Record<string, unknown>).fg === input.fg &&
            (x as Record<string, unknown>).bg === input.bg,
        );
      return {
        ok: true,
        data: {
          brand: input.brand,
          version: PACKAGE_VERSION,
          mode,
          pass: value >= threshold,
          brand_pair_allowed: allowed,
          rule_id: rule?.id,
          evidence: {
            ratio: value,
            threshold,
            requested_fg: input.fg,
            requested_bg: input.bg,
            resolved_fg: fg,
            resolved_bg: bg,
            resolved_mode: mode,
            text_size: input.text_size,
          },
        },
      };
    },
  },
] as const;

export async function createDispatcher(config = process.env.BRAND_API_KEYS) {
  const artifacts = new Map<string, PipelineArtifacts>();
  for (const brand of brands)
    for (const mode of brand === "alpha" ? ["light", "dark"] : ["default"])
      artifacts.set(
        lookup(brand, mode),
        await buildBrandArtifacts(brand, mode),
      );
  const auth = createAuthorizer(config, brands);
  const dispatch = (
    id: ToolId,
    raw: unknown,
    credential: string | undefined,
  ): Envelope => {
    try {
      const principal = auth.authenticate(credential);
      const entry = registry.find((item) => item.id === id);
      if (!entry) throw new DemoError("TOOL_NOT_FOUND", "Tool not found.");
      const parsed = entry.inputSchema.safeParse(raw);
      if (!parsed.success)
        throw new DemoError("INVALID_ARGUMENT", "Invalid arguments.");
      auth.authorize(principal, parsed.data.brand);
      const mode =
        "mode" in parsed.data
          ? (parsed.data.mode ??
            defaults[parsed.data.brand as keyof typeof defaults])
          : defaults[parsed.data.brand as keyof typeof defaults];
      const artifact = artifacts.get(lookup(parsed.data.brand, mode));
      if (!artifact) throw new DemoError("MODE_NOT_FOUND", "Mode not found.");
      return entry.handler(parsed.data as never, artifact, mode);
    } catch (error) {
      return failure(error);
    }
  };
  return { dispatch };
}
const status = (result: Envelope) =>
  result.ok
    ? 200
    : result.error.code === "UNAUTHORIZED"
      ? 401
      : result.error.code === "BRAND_NOT_ALLOWED"
        ? 403
        : result.error.code === "INTERNAL_ERROR"
          ? 500
          : result.error.code === "INVALID_ARGUMENT"
            ? 400
            : 404;
export async function createRestServer(config?: string) {
  const dispatcher = await createDispatcher(config);
  return createServer(async (req, res) => {
    const match =
      req.method === "POST" && /^\/tools\/([^/]+)$/.exec(req.url ?? "");
    const entry = match && registry.find((item) => item.id === match[1]);
    if (!entry) {
      res.writeHead(404, { "content-type": "application/json" }).end(
        JSON.stringify(failure(new DemoError("TOOL_NOT_FOUND", "Tool not found."))),
      );
      return;
    }
    let body = "";
    try {
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 65536) throw new Error("large");
      }
    } catch {
      res
        .writeHead(400, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            ok: false,
            error: { code: "INVALID_ARGUMENT", message: "Invalid arguments." },
          }),
        );
      return;
    }
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      input = undefined;
    }
    const result = dispatcher.dispatch(
      entry.id,
      input,
      bearerCredential(req.rawHeaders),
    );
    res
      .writeHead(status(result), { "content-type": "application/json" })
      .end(JSON.stringify(result));
  });
}
export async function createMcp(
  config?: string,
  credential = process.env.BRAND_API_KEY,
) {
  const dispatcher = await createDispatcher(config);
  const server = new McpServer({
    name: "figma-brand-rules-demo",
    version: PACKAGE_VERSION,
  });
  for (const entry of registry)
    server.registerTool(
      entry.id,
      {
        inputSchema: entry.inputSchema,
        outputSchema: entry.outputSchema,
        _meta: { status: entry.status },
      },
      async (args: Record<string, unknown>) => {
        const result = dispatcher.dispatch(entry.id, args, credential);
        return {
          isError: !result.ok,
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      },
    );
  return server;
}
export async function serveStdio() {
  const server = await createMcp();
  await server.connect(new StdioServerTransport());
}
