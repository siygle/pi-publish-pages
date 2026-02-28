/**
 * pi-publish-pages — Telegraph wrapper extension for pi.
 *
 * Publishes markdown content to telegra.ph with full CRUD:
 *   create  — publish a new page
 *   update  — edit an existing page
 *   delete  — soft-delete (clear content, show localized "deleted" notice)
 *   list    — list all pages under the account
 *   get     — get page info
 *
 * Config: ~/.pi/publish-pages/config.json
 */

import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { TelegraphClient, type TelegraphConfig } from "./telegraph.js";
import { markdownToNodes } from "./md.js";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

const DELETED_NOTICES: Record<string, { title: string; body: string }> = {
  "zh-TW": { title: "此頁面已刪除", body: "此頁面已刪除。" },
  "zh-CN": { title: "此页面已删除", body: "此页面已删除。" },
  en: { title: "This page has been deleted", body: "This page has been deleted." },
  ja: { title: "このページは削除されました", body: "このページは削除されました。" },
  ko: { title: "이 페이지는 삭제되었습니다", body: "이 페이지는 삭제되었습니다." },
};

function getDeletedNotice(lang: string) {
  return DELETED_NOTICES[lang] || DELETED_NOTICES["zh-TW"];
}

export default function (pi: ExtensionAPI) {
  const configDir = path.join(os.homedir(), ".pi", "publish-pages");
  const configPath = path.join(configDir, "config.json");
  let client: TelegraphClient | null = null;

  function loadClient(): TelegraphClient | null {
    // Try extension config first
    try {
      if (fs.existsSync(configPath)) {
        const config: TelegraphConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if (config.access_token) return new TelegraphClient(config);
      }
    } catch {}

    // Fallback: try the old schedule-config telegraph.json
    try {
      const legacyPath = path.join(os.homedir(), ".pi", "agent", "schedule-config", "telegraph.json");
      if (fs.existsSync(legacyPath)) {
        const config: TelegraphConfig = JSON.parse(fs.readFileSync(legacyPath, "utf-8"));
        if (config.access_token) return new TelegraphClient(config);
      }
    } catch {}

    return null;
  }

  // ── Lifecycle ────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    client = loadClient();
    if (client) {
      ctx.ui.setStatus("publish-pages", "📄 Telegraph: ready");
    }
  });

  // ── Tool ─────────────────────────────────────────────────

  pi.registerTool({
    name: "publish_page",
    label: "Publish Page",
    description: [
      "Publish, update, delete, or list pages on Telegraph (telegra.ph).",
      "Use this when you need to share long-form content via a URL.",
      "",
      "Actions:",
      '  create — publish a new page. Requires "title" and "markdown".',
      '  update — edit existing page. Requires "path" (from URL), plus "title" and/or "markdown".',
      '  delete — soft-delete page (replaces content with "deleted" notice). Requires "path".',
      '  list   — list all pages with titles and URLs.',
      '  get    — get page info and content. Requires "path".',
      "",
      "The page path is the last part of the Telegraph URL, e.g. for",
      "https://telegra.ph/My-Page-02-27, the path is \"My-Page-02-27\".",
    ].join("\n"),
    parameters: Type.Object({
      action: StringEnum(["create", "update", "delete", "list", "get"] as const, {
        description: "Action to perform",
      }),
      path: Type.Optional(
        Type.String({ description: 'Page path from Telegraph URL (for update/delete/get), e.g. "My-Page-02-27"' })
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
          description: 'Language for the delete notice: "zh-TW", "zh-CN", "en", "ja", "ko". Default: "zh-TW"',
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { action, path: pagePath, title, markdown, author, lang } = params as {
        action: "create" | "update" | "delete" | "list" | "get";
        path?: string;
        title?: string;
        markdown?: string;
        author?: string;
        lang?: string;
      };

      if (!client) {
        client = loadClient();
        if (!client) {
          return err(
            "Telegraph 尚未設定。請建立 ~/.pi/publish-pages/config.json，包含 access_token。\n" +
            '可以用 /pages-setup 指令來設定，或手動建立：\n' +
            '{"access_token": "YOUR_TOKEN", "author_name": "Pi Agent"}'
          );
        }
      }

      try {
        switch (action) {
          case "create": {
            if (!title || !markdown) {
              return err('create 需要提供 "title" 和 "markdown"');
            }
            const nodes = markdownToNodes(markdown);
            const page = await client.createPage(title, nodes, author);
            return ok(`頁面已建立。\n\nURL: ${page.url}\nPath: ${page.path}`, {
              action: "create",
              path: page.path,
              url: page.url,
              title: page.title,
            });
          }

          case "update": {
            if (!pagePath) return err('update 需要提供 "path"');
            if (!title && !markdown) return err('update 至少需要提供 "title" 或 "markdown"');

            // Get current page if we need to preserve title or content
            let currentTitle = title || "";
            let nodes = markdown ? markdownToNodes(markdown) : [];

            if (!title || !markdown) {
              const current = await client.getPage(pagePath, true);
              if (!title) currentTitle = current.title;
              if (!markdown) nodes = current.content || [];
            }

            const page = await client.editPage(pagePath, currentTitle, nodes, author);
            return ok(`頁面已更新。\n\nURL: ${page.url}`, {
              action: "update",
              path: page.path,
              url: page.url,
              title: page.title,
            });
          }

          case "delete": {
            if (!pagePath) return err('delete 需要提供 "path"');
            const notice = getDeletedNotice(lang || "zh-TW");
            const deletedContent = [{ tag: "p" as const, children: [notice.body] }];
            const page = await client.editPage(pagePath, notice.title, deletedContent);
            return ok(
              `頁面已刪除（內容已清空，顯示刪除提示）。\n\nURL: ${page.url}`,
              { action: "delete", path: page.path, url: page.url }
            );
          }

          case "list": {
            const result = await client.getPageList(0, 50);
            if (result.total_count === 0) {
              return ok("目前沒有已發佈的頁面。", { action: "list", pages: [], total: 0 });
            }
            const lines = result.pages.map((p) =>
              `- ${p.title}\n  ${p.url}  (views: ${p.views})`
            );
            return ok(
              `共 ${result.total_count} 個頁面：\n\n${lines.join("\n\n")}`,
              {
                action: "list",
                total: result.total_count,
                pages: result.pages.map((p) => ({
                  path: p.path,
                  url: p.url,
                  title: p.title,
                  views: p.views,
                })),
              }
            );
          }

          case "get": {
            if (!pagePath) return err('get 需要提供 "path"');
            const page = await client.getPage(pagePath, false);
            return ok(
              `標題: ${page.title}\nURL: ${page.url}\n瀏覽次數: ${page.views}`,
              {
                action: "get",
                path: page.path,
                url: page.url,
                title: page.title,
                views: page.views,
              }
            );
          }
        }
      } catch (e: any) {
        return err(e.message);
      }
    },
  });

  // ── Commands ─────────────────────────────────────────────

  pi.registerCommand("pages", {
    description: "列出 Telegraph 上的所有頁面",
    handler: async (_args, ctx) => {
      if (!client) {
        client = loadClient();
        if (!client) {
          ctx.ui.notify("Telegraph 尚未設定。請使用 /pages-setup 來設定。", "warning");
          return;
        }
      }
      try {
        const result = await client.getPageList(0, 20);
        if (result.total_count === 0) {
          ctx.ui.notify("目前沒有已發佈的頁面。", "info");
          return;
        }
        const lines = result.pages.map(
          (p) => `📄 ${p.title}\n   ${p.url}`
        );
        ctx.ui.notify(`共 ${result.total_count} 個頁面：\n${lines.join("\n")}`, "info");
      } catch (e: any) {
        ctx.ui.notify(`錯誤: ${e.message}`, "error");
      }
    },
  });

  pi.registerCommand("pages-setup", {
    description: "設定 Telegraph access token",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("此指令需要互動式介面。", "warning");
        return;
      }

      const choices = client
        ? ["查看目前設定", "重新建立帳號", "手動輸入 token"]
        : ["建立新帳號", "手動輸入 token"];

      const choice = await ctx.ui.select("Telegraph 設定：", choices);
      if (choice === undefined) return;

      const selected = choices[choice as unknown as number];
      if (selected === "查看目前設定") {
        ctx.ui.notify(`Token: ${client!.token.slice(0, 8)}...`, "info");
        return;
      }

      let token: string | undefined;

      if (selected.includes("建立")) {
        const name = await ctx.ui.input("作者名稱:", "Pi Agent");
        if (!name) return;
        try {
          const tmpClient = new TelegraphClient({ access_token: "" });
          const account = await tmpClient.createAccount("PiAgent", name);
          token = account.access_token!;
          ctx.ui.notify(`帳號已建立！Token: ${token.slice(0, 8)}...`, "info");
        } catch (e: any) {
          ctx.ui.notify(`建立帳號失敗: ${e.message}`, "error");
          return;
        }
      } else {
        token = await ctx.ui.input("輸入 Telegraph access token:");
        if (!token) return;
      }

      // Save config
      fs.mkdirSync(configDir, { recursive: true });
      const config: TelegraphConfig = {
        access_token: token,
        author_name: "Pi Agent",
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
      client = new TelegraphClient(config);
      ctx.ui.setStatus("publish-pages", "📄 Telegraph: ready");
      ctx.ui.notify("✅ Telegraph 設定完成！", "info");
    },
  });
}

// ── Helpers ──────────────────────────────────────────────

function ok(text: string, details: Record<string, any>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function err(text: string) {
  return {
    content: [{ type: "text" as const, text: `錯誤: ${text}` }],
    details: { error: text },
    isError: true,
  };
}
