/**
 * pi-publish-pages — Self-hosted Telegraph alternative with delete support.
 *
 * Pages are stored as JSON files under ~/.pi/publish-pages/pages/<id>.json
 * and served by a lightweight HTTP server.
 *
 * Tools:
 *   publish_page  — create / update / delete / list pages
 *
 * Commands:
 *   /pages        — list published pages
 *   /pages-server — show server status / start / stop
 */

import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { PageStore, type PageMeta } from "./store.js";
import { PageServer } from "./server.js";
import { markdownToHtml } from "./md.js";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

export default function (pi: ExtensionAPI) {
  const dataDir = path.join(os.homedir(), ".pi", "publish-pages");
  const store = new PageStore(dataDir);

  // Load config
  const configPath = path.join(dataDir, "config.json");
  const config = loadConfig(configPath);
  const server = new PageServer(store, config);

  // ── Lifecycle ────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    store.init();
    if (config.autoStart !== false) {
      try {
        await server.start();
        ctx.ui.setStatus(
          "publish-pages",
          `📄 Pages: ${config.baseUrl || `http://localhost:${config.port || 8787}`}`
        );
      } catch (err: any) {
        // Port might be in use by another pi session — that's fine
        if (err?.code === "EADDRINUSE") {
          ctx.ui.setStatus("publish-pages", `📄 Pages: server already running`);
        } else {
          ctx.ui.notify(`publish-pages server error: ${err.message}`, "error");
        }
      }
    }
  });

  pi.on("session_shutdown", async () => {
    server.stop();
  });

  // ── Tool ─────────────────────────────────────────────────

  pi.registerTool({
    name: "publish_page",
    label: "Publish Page",
    description: [
      "Create, update, delete, or list self-hosted web pages (Telegraph alternative).",
      "Pages are served at a public URL. Supports markdown content.",
      "",
      "Actions:",
      '  create  — publish a new page (returns URL). Provide "title" and "markdown".',
      '  update  — update an existing page. Provide "id", and optionally "title" and/or "markdown".',
      '  delete  — soft-delete a page (content replaced with "Deleted" notice). Provide "id".',
      '  list    — list all pages with their URLs and titles.',
    ].join("\n"),
    parameters: Type.Object({
      action: StringEnum(["create", "update", "delete", "list"] as const, {
        description: "Action to perform",
      }),
      id: Type.Optional(
        Type.String({ description: "Page ID (required for update/delete)" })
      ),
      title: Type.Optional(
        Type.String({ description: "Page title (for create/update)" })
      ),
      markdown: Type.Optional(
        Type.String({ description: "Page content in markdown (for create/update)" })
      ),
      author: Type.Optional(
        Type.String({ description: "Author name (for create/update)" })
      ),
      lang: Type.Optional(
        Type.String({
          description: 'Page language code, e.g. "zh-TW", "en", "ja". Affects the deleted notice language. Default: "zh-TW"',
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { action, id, title, markdown, author, lang } = params as {
        action: "create" | "update" | "delete" | "list";
        id?: string;
        title?: string;
        markdown?: string;
        author?: string;
        lang?: string;
      };

      try {
        switch (action) {
          case "create": {
            if (!title || !markdown) {
              return err('create requires "title" and "markdown"');
            }
            const page = store.create({ title, markdown, author, lang });
            const url = pageUrl(config, page.id);
            return ok(`Page created.\n\nURL: ${url}\nID: ${page.id}`, {
              action: "create",
              id: page.id,
              url,
              title: page.title,
            });
          }

          case "update": {
            if (!id) return err('update requires "id"');
            const page = store.update(id, { title, markdown, author, lang });
            if (!page) return err(`Page not found: ${id}`);
            const url = pageUrl(config, page.id);
            return ok(`Page updated.\n\nURL: ${url}`, {
              action: "update",
              id: page.id,
              url,
              title: page.title,
            });
          }

          case "delete": {
            if (!id) return err('delete requires "id"');
            const page = store.softDelete(id, lang);
            if (!page) return err(`Page not found: ${id}`);
            const url = pageUrl(config, page.id);
            return ok(`Page deleted (content cleared, shows deleted notice).\n\nURL: ${url}`, {
              action: "delete",
              id: page.id,
              url,
            });
          }

          case "list": {
            const pages = store.list();
            if (pages.length === 0) {
              return ok("No published pages.", { action: "list", pages: [] });
            }
            const lines = pages.map((p) => {
              const url = pageUrl(config, p.id);
              const status = p.deleted ? " [DELETED]" : "";
              return `- ${p.title}${status}\n  URL: ${url}\n  ID: ${p.id}  Created: ${new Date(p.createdAt).toISOString()}`;
            });
            return ok(`Published pages:\n\n${lines.join("\n\n")}`, {
              action: "list",
              pages: pages.map((p) => ({
                id: p.id,
                title: p.title,
                url: pageUrl(config, p.id),
                deleted: p.deleted,
                createdAt: p.createdAt,
              })),
            });
          }
        }
      } catch (e: any) {
        return err(e.message);
      }
    },
  });

  // ── Commands ─────────────────────────────────────────────

  pi.registerCommand("pages", {
    description: "List published pages",
    handler: async (_args, ctx) => {
      const pages = store.list();
      if (pages.length === 0) {
        ctx.ui.notify("No published pages.", "info");
        return;
      }
      const lines = pages.map((p) => {
        const url = pageUrl(config, p.id);
        const status = p.deleted ? " ❌" : " ✅";
        return `${status} ${p.title} — ${url}`;
      });
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("pages-server", {
    description: "Show publish-pages server status",
    handler: async (_args, ctx) => {
      const running = server.isRunning();
      const url = config.baseUrl || `http://localhost:${config.port || 8787}`;
      ctx.ui.notify(
        `📄 Publish Pages Server: ${running ? "🟢 Running" : "🔴 Stopped"}\n   ${url}`,
        "info"
      );
    },
  });
}

// ── Helpers ──────────────────────────────────────────────

function pageUrl(config: any, id: string): string {
  const base = (config.baseUrl || `http://localhost:${config.port || 8787}`).replace(
    /\/$/,
    ""
  );
  return `${base}/${id}`;
}

function ok(text: string, details: Record<string, any>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function err(text: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${text}` }],
    details: { error: text },
    isError: true,
  };
}

function loadConfig(configPath: string): Record<string, any> {
  const defaults = {
    port: 8787,
    baseUrl: "",
    autoStart: true,
  };
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return { ...defaults, ...raw };
    }
  } catch {}
  return defaults;
}
