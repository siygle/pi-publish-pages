/**
 * pi-publish-pages — publish markdown pages for pi.
 *
 * Provider priority:
 *   1. AgentGate — encrypted file sharing, preferred for new pages
 *   2. Telegraph — public page hosting, used as fallback and for CRUD operations
 *
 * Config: ~/.pi/publish-pages/config.json
 */

import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { AgentGateClient, type AgentGateConfig } from "./agentgate.js";
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

type ProviderName = "agentgate" | "telegraph";

interface PublishPagesConfig {
  provider_priority?: ProviderName[];
  agentgate?: AgentGateConfig;
  telegraph?: TelegraphConfig;
  access_token?: string;
  author_name?: string;
  short_name?: string;
}

function getDeletedNotice(lang: string) {
  return DELETED_NOTICES[lang] || DELETED_NOTICES["zh-TW"];
}

export default function (pi: ExtensionAPI) {
  const configDir = path.join(os.homedir(), ".pi", "publish-pages");
  const configPath = path.join(configDir, "config.json");
  let agentGateClient: AgentGateClient | null = null;
  let telegraphClient: TelegraphClient | null = null;
  let activeConfig: PublishPagesConfig = {};
  let agentGateCliAvailable = false;

  function loadConfig(): PublishPagesConfig {
    try {
      if (fs.existsSync(configPath)) {
        const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as PublishPagesConfig;
        const telegraph = raw.telegraph || (raw.access_token
          ? {
              access_token: raw.access_token,
              author_name: raw.author_name,
              short_name: raw.short_name,
            }
          : undefined);

        return {
          provider_priority: raw.provider_priority || ["agentgate", "telegraph"],
          agentgate: raw.agentgate,
          telegraph,
          access_token: raw.access_token,
          author_name: raw.author_name,
          short_name: raw.short_name,
        };
      }
    } catch {}

    return { provider_priority: ["agentgate", "telegraph"] };
  }

  function loadTelegraphClient(config: PublishPagesConfig): TelegraphClient | null {
    try {
      if (config.telegraph?.access_token) {
        return new TelegraphClient(config.telegraph);
      }
    } catch {}

    try {
      const legacyPath = path.join(os.homedir(), ".pi", "agent", "schedule-config", "telegraph.json");
      if (fs.existsSync(legacyPath)) {
        const legacyConfig: TelegraphConfig = JSON.parse(fs.readFileSync(legacyPath, "utf-8"));
        if (legacyConfig.access_token) return new TelegraphClient(legacyConfig);
      }
    } catch {}

    return null;
  }

  async function loadClients() {
    activeConfig = loadConfig();
    agentGateClient = activeConfig.agentgate?.server_url ? new AgentGateClient(activeConfig.agentgate) : null;
    telegraphClient = loadTelegraphClient(activeConfig);
    agentGateCliAvailable = agentGateClient ? await agentGateClient.isCliInstalled() : false;
  }

  function saveConfig(nextConfig: PublishPagesConfig) {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), { mode: 0o600 });
  }

  function preferredProviders(): ProviderName[] {
    const priority = activeConfig.provider_priority || ["agentgate", "telegraph"];
    return [...new Set(priority)].filter((provider): provider is ProviderName =>
      provider === "agentgate" || provider === "telegraph"
    );
  }

  function agentGateMissingCliWarning() {
    return "AgentGate 已設定，但找不到 `agentgate` CLI。請先安裝，例如：go install github.com/siygle/agentgate/cmd/agentgate@latest";
  }

  function telegraphOnlyAction(action: string) {
    return action === "update" || action === "delete" || action === "list" || action === "get";
  }

  function statusText() {
    const ready: string[] = [];
    if (agentGateClient) {
      ready.push(agentGateCliAvailable ? "🔐 AgentGate" : "⚠️ AgentGate CLI missing");
    }
    if (telegraphClient) ready.push("📄 Telegraph");
    if (!ready.length) return null;
    return `${ready.join(" + ")}: ready`;
  }

  // ── Lifecycle ────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    await loadClients();
    const status = statusText();
    if (status) {
      ctx.ui.setStatus("publish-pages", status);
    }
    if (agentGateClient && !agentGateCliAvailable) {
      ctx.ui.notify(agentGateMissingCliWarning(), "warning");
    }
  });

  // ── Tool ─────────────────────────────────────────────────

  pi.registerTool({
    name: "publish_page",
    label: "Publish Page",
    description: [
      "Publish, update, delete, or list shared pages.",
      "Provider priority for create: AgentGate first, Telegraph second.",
      "Use AgentGate for encrypted ephemeral sharing; Telegraph is the fallback and supports CRUD/list/get.",
      "",
      "Actions:",
      '  create — publish a new page. Requires "title" and "markdown".',
      '  update — edit existing Telegraph page. Requires "path".',
      '  delete — soft-delete existing Telegraph page. Requires "path".',
      '  list   — list Telegraph pages.',
      '  get    — get Telegraph page info. Requires "path".',
      "",
      'Optional provider: "auto" (default), "agentgate", or "telegraph".',
    ].join("\n"),
    parameters: Type.Object({
      action: StringEnum(["create", "update", "delete", "list", "get"] as const, {
        description: "Action to perform",
      }),
      provider: Type.Optional(
        StringEnum(["auto", "agentgate", "telegraph"] as const, {
          description: 'Provider selection. Default: "auto" (AgentGate first, Telegraph fallback)',
        })
      ),
      path: Type.Optional(
        Type.String({ description: 'Page path from Telegraph URL (for update/delete/get), e.g. "My-Page-02-27"' })
      ),
      title: Type.Optional(Type.String({ description: "Page title (for create/update)" })),
      markdown: Type.Optional(Type.String({ description: "Page content in markdown (for create/update)" })),
      author: Type.Optional(Type.String({ description: "Author name (for create/update)" })),
      passphrase: Type.Optional(Type.String({ description: "AgentGate passphrase override for create" })),
      lang: Type.Optional(
        Type.String({
          description: 'Language for the delete notice: "zh-TW", "zh-CN", "en", "ja", "ko". Default: "zh-TW"',
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { action, provider = "auto", path: pagePath, title, markdown, author, passphrase, lang } = params as {
        action: "create" | "update" | "delete" | "list" | "get";
        provider?: "auto" | ProviderName;
        path?: string;
        title?: string;
        markdown?: string;
        author?: string;
        passphrase?: string;
        lang?: string;
      };

      await loadClients();

      if (telegraphOnlyAction(action) && provider === "agentgate") {
        return err(`動作 ${action} 目前僅支援 Telegraph。`);
      }

      try {
        switch (action) {
          case "create": {
            if (!title || !markdown) {
              return err('create 需要提供 "title" 和 "markdown"');
            }

            const providers = provider === "auto"
              ? preferredProviders()
              : [provider];

            let lastError: string | null = null;

            for (const currentProvider of providers) {
              if (currentProvider === "agentgate") {
                if (!agentGateClient) {
                  lastError = "AgentGate 尚未設定。請在 ~/.pi/publish-pages/config.json 設定 agentgate.server_url。";
                  continue;
                }
                if (!agentGateCliAvailable) {
                  lastError = agentGateMissingCliWarning();
                  continue;
                }

                try {
                  const page = await agentGateClient.createMarkdownPage(title, markdown, passphrase);
                  return ok(
                    `頁面已建立（AgentGate）。\n\nURL: ${page.url}\nPassphrase: ${page.passphrase}\n\n注意：AgentGate 內容為加密分享，開啟後需要輸入 passphrase。`,
                    {
                      action: "create",
                      provider: "agentgate",
                      id: page.id,
                      url: page.url,
                      title: page.title,
                      filename: page.filename,
                      passphrase: page.passphrase,
                    }
                  );
                } catch (e: any) {
                  lastError = `AgentGate: ${e.message}`;
                  continue;
                }
              }

              if (currentProvider === "telegraph") {
                if (!telegraphClient) {
                  lastError = "Telegraph 尚未設定。請建立 ~/.pi/publish-pages/config.json 的 telegraph.access_token。";
                  continue;
                }

                try {
                  const nodes = markdownToNodes(markdown);
                  const page = await telegraphClient.createPage(title, nodes, author);
                  return ok(`頁面已建立（Telegraph）。\n\nURL: ${page.url}\nPath: ${page.path}`, {
                    action: "create",
                    provider: "telegraph",
                    path: page.path,
                    url: page.url,
                    title: page.title,
                  });
                } catch (e: any) {
                  lastError = `Telegraph: ${e.message}`;
                  continue;
                }
              }
            }

            return err(lastError || "沒有可用的發佈提供者。請先設定 AgentGate 或 Telegraph。");
          }

          case "update": {
            if (!telegraphClient) {
              return err("Telegraph 尚未設定。update 需要 telegraph.access_token。");
            }
            if (!pagePath) return err('update 需要提供 "path"');
            if (!title && !markdown) return err('update 至少需要提供 "title" 或 "markdown"');

            let currentTitle = title || "";
            let nodes = markdown ? markdownToNodes(markdown) : [];

            if (!title || !markdown) {
              const current = await telegraphClient.getPage(pagePath, true);
              if (!title) currentTitle = current.title;
              if (!markdown) nodes = current.content || [];
            }

            const page = await telegraphClient.editPage(pagePath, currentTitle, nodes, author);
            return ok(`頁面已更新（Telegraph）。\n\nURL: ${page.url}`, {
              action: "update",
              provider: "telegraph",
              path: page.path,
              url: page.url,
              title: page.title,
            });
          }

          case "delete": {
            if (!telegraphClient) {
              return err("Telegraph 尚未設定。delete 需要 telegraph.access_token。");
            }
            if (!pagePath) return err('delete 需要提供 "path"');
            const notice = getDeletedNotice(lang || "zh-TW");
            const deletedContent = [{ tag: "p" as const, children: [notice.body] }];
            const page = await telegraphClient.editPage(pagePath, notice.title, deletedContent);
            return ok(`頁面已刪除（Telegraph 軟刪除）。\n\nURL: ${page.url}`, {
              action: "delete",
              provider: "telegraph",
              path: page.path,
              url: page.url,
            });
          }

          case "list": {
            if (!telegraphClient) {
              return err("Telegraph 尚未設定。list 需要 telegraph.access_token。");
            }
            const result = await telegraphClient.getPageList(0, 50);
            if (result.total_count === 0) {
              return ok("目前沒有已發佈的 Telegraph 頁面。", { action: "list", provider: "telegraph", pages: [], total: 0 });
            }
            const lines = result.pages.map((p) => `- ${p.title}\n  ${p.url}  (views: ${p.views})`);
            return ok(`共 ${result.total_count} 個 Telegraph 頁面：\n\n${lines.join("\n\n")}`, {
              action: "list",
              provider: "telegraph",
              total: result.total_count,
              pages: result.pages.map((p) => ({
                path: p.path,
                url: p.url,
                title: p.title,
                views: p.views,
              })),
            });
          }

          case "get": {
            if (!telegraphClient) {
              return err("Telegraph 尚未設定。get 需要 telegraph.access_token。");
            }
            if (!pagePath) return err('get 需要提供 "path"');
            const page = await telegraphClient.getPage(pagePath, false);
            return ok(`標題: ${page.title}\nURL: ${page.url}\n瀏覽次數: ${page.views}`, {
              action: "get",
              provider: "telegraph",
              path: page.path,
              url: page.url,
              title: page.title,
              views: page.views,
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
    description: "列出 Telegraph 上的所有頁面",
    handler: async (_args, ctx) => {
      await loadClients();
      if (!telegraphClient) {
        ctx.ui.notify("Telegraph 尚未設定。/pages 目前僅列出 Telegraph 頁面。", "warning");
        return;
      }
      try {
        const result = await telegraphClient.getPageList(0, 20);
        if (result.total_count === 0) {
          ctx.ui.notify("目前沒有已發佈的 Telegraph 頁面。", "info");
          return;
        }
        const lines = result.pages.map((p) => `📄 ${p.title}\n   ${p.url}`);
        ctx.ui.notify(`共 ${result.total_count} 個 Telegraph 頁面：\n${lines.join("\n")}`, "info");
      } catch (e: any) {
        ctx.ui.notify(`錯誤: ${e.message}`, "error");
      }
    },
  });

  pi.registerCommand("pages-setup", {
    description: "設定 AgentGate / Telegraph 發佈提供者",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("此指令需要互動式介面。", "warning");
        return;
      }

      await loadClients();

      const choice = await ctx.ui.select("publish-pages 設定：", [
        "查看目前設定",
        "設定 AgentGate server URL",
        "設定 AgentGate 預設 passphrase（可留空）",
        "設定 Telegraph access token",
        "設定 provider priority",
      ]);
      if (choice === undefined) return;

      const selected = [
        "查看目前設定",
        "設定 AgentGate server URL",
        "設定 AgentGate 預設 passphrase（可留空）",
        "設定 Telegraph access token",
        "設定 provider priority",
      ][choice as unknown as number];

      const config = loadConfig();

      if (selected === "查看目前設定") {
        const lines = [
          `Priority: ${(config.provider_priority || ["agentgate", "telegraph"]).join(" > ")}`,
          `AgentGate: ${config.agentgate?.server_url || "未設定"}`,
          `AgentGate CLI: ${agentGateClient ? (agentGateCliAvailable ? "已安裝" : "未安裝") : "未啟用"}`,
          `AgentGate passphrase: ${config.agentgate?.passphrase ? "已設定" : "未設定（建立時自動產生）"}`,
          `Telegraph: ${config.telegraph?.access_token ? "已設定" : "未設定"}`,
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (selected === "設定 AgentGate server URL") {
        const serverUrl = await ctx.ui.input("AgentGate server URL:", config.agentgate?.server_url || "https://agentgate.sylee.dev");
        if (!serverUrl) return;
        saveConfig({
          ...config,
          provider_priority: config.provider_priority || ["agentgate", "telegraph"],
          agentgate: {
            ...config.agentgate,
            server_url: serverUrl,
          },
        });
        await loadClients();
        ctx.ui.notify(
          agentGateCliAvailable
            ? "✅ AgentGate server URL 已儲存。"
            : `✅ AgentGate server URL 已儲存。\n⚠️ ${agentGateMissingCliWarning()}`,
          agentGateCliAvailable ? "info" : "warning"
        );
      }

      if (selected === "設定 AgentGate 預設 passphrase（可留空）") {
        const value = await ctx.ui.input("AgentGate 預設 passphrase（留空代表每次自動產生）:", config.agentgate?.passphrase || "");
        if (value === undefined) return;
        saveConfig({
          ...config,
          provider_priority: config.provider_priority || ["agentgate", "telegraph"],
          agentgate: {
            ...config.agentgate,
            server_url: config.agentgate?.server_url || "https://agentgate.sylee.dev",
            passphrase: value || undefined,
          },
        });
        await loadClients();
        ctx.ui.notify(value ? "✅ AgentGate 預設 passphrase 已儲存。" : "✅ 已清除預設 passphrase，之後會自動產生。", "info");
      }

      if (selected === "設定 Telegraph access token") {
        const token = await ctx.ui.input("輸入 Telegraph access token:", config.telegraph?.access_token || config.access_token || "");
        if (!token) return;
        saveConfig({
          ...config,
          provider_priority: config.provider_priority || ["agentgate", "telegraph"],
          telegraph: {
            access_token: token,
            author_name: config.telegraph?.author_name || config.author_name || "Pi Agent",
            short_name: config.telegraph?.short_name || config.short_name,
          },
        });
        await loadClients();
        ctx.ui.notify("✅ Telegraph access token 已儲存。", "info");
      }

      if (selected === "設定 provider priority") {
        const order = await ctx.ui.input(
          '輸入 provider priority（例如: "agentgate,telegraph" 或 "telegraph,agentgate"）:',
          (config.provider_priority || ["agentgate", "telegraph"]).join(",")
        );
        if (!order) return;
        const priority = order
          .split(",")
          .map((v) => v.trim().toLowerCase())
          .filter((v): v is ProviderName => v === "agentgate" || v === "telegraph");
        if (!priority.length) {
          ctx.ui.notify("至少要包含一個有效 provider：agentgate 或 telegraph", "warning");
          return;
        }
        saveConfig({
          ...config,
          provider_priority: priority,
        });
        await loadClients();
        ctx.ui.notify(`✅ provider priority 已更新為 ${priority.join(" > ")}`, "info");
      }

      const status = statusText();
      if (status) ctx.ui.setStatus("publish-pages", status);
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
