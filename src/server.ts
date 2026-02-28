/**
 * Lightweight HTTP server for serving published pages.
 */

import * as http from "http";
import type { PageStore } from "./store.js";

const PAGE_TEMPLATE = (title: string, body: string, author?: string, lang = "zh-TW") => `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<style>
  :root {
    --bg: #fff;
    --fg: #1a1a1a;
    --muted: #6b7280;
    --border: #e5e7eb;
    --accent: #2563eb;
    --code-bg: #f3f4f6;
    --block-bg: #f9fafb;
    --table-hover: #f9fafb;
    --deleted-bg: #fef2f2;
    --deleted-fg: #991b1b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #111827;
      --fg: #f3f4f6;
      --muted: #9ca3af;
      --border: #374151;
      --accent: #60a5fa;
      --code-bg: #1f2937;
      --block-bg: #1f2937;
      --table-hover: #1f2937;
      --deleted-bg: #451a1a;
      --deleted-fg: #fca5a5;
    }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", "Noto Sans SC", sans-serif;
    background: var(--bg);
    color: var(--fg);
    line-height: 1.75;
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
  }
  h1 { font-size: 1.75rem; margin-bottom: 0.25rem; line-height: 1.3; }
  .meta { color: var(--muted); font-size: 0.85rem; margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem; }
  h2 { font-size: 1.35rem; margin-top: 2rem; margin-bottom: 0.5rem; }
  h3 { font-size: 1.15rem; margin-top: 1.5rem; margin-bottom: 0.4rem; }
  h4, h5, h6 { font-size: 1rem; margin-top: 1.25rem; margin-bottom: 0.3rem; }
  p { margin-bottom: 1rem; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  strong { font-weight: 600; }
  code {
    font-family: "SF Mono", "Fira Code", monospace;
    background: var(--code-bg);
    padding: 0.15em 0.35em;
    border-radius: 4px;
    font-size: 0.9em;
  }
  pre {
    background: var(--code-bg);
    padding: 1rem;
    border-radius: 6px;
    overflow-x: auto;
    margin-bottom: 1rem;
    line-height: 1.5;
  }
  pre code { background: none; padding: 0; font-size: 0.85em; }
  blockquote {
    border-left: 3px solid var(--accent);
    background: var(--block-bg);
    padding: 0.75rem 1rem;
    margin: 1rem 0;
    border-radius: 0 6px 6px 0;
  }
  blockquote p { margin-bottom: 0; }
  ul, ol { padding-left: 1.5rem; margin-bottom: 1rem; }
  li { margin-bottom: 0.35rem; }
  hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1rem;
    font-size: 0.9em;
  }
  th, td { padding: 0.5rem 0.75rem; border: 1px solid var(--border); text-align: left; }
  th { background: var(--block-bg); font-weight: 600; }
  tr:hover { background: var(--table-hover); }
  img { max-width: 100%; border-radius: 6px; margin: 0.5rem 0; }
  .deleted {
    text-align: center;
    padding: 3rem 1rem;
    background: var(--deleted-bg);
    color: var(--deleted-fg);
    border-radius: 8px;
    margin-top: 2rem;
    font-size: 1.1rem;
  }
</style>
</head>
<body>
<article>
  <h1>${escHtml(title)}</h1>
  <div class="meta">${author ? escHtml(author) + " · " : ""}${new Date().toLocaleDateString(lang, { year: "numeric", month: "long", day: "numeric" })}</div>
  ${body}
</article>
</body>
</html>`;

const NOT_FOUND_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;color:#6b7280;}h1{font-weight:300;font-size:1.5rem;}</style>
</head><body><h1>404 — Page not found</h1></body></html>`;

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export class PageServer {
  private server: http.Server | null = null;
  private port: number;
  private config: Record<string, any>;

  constructor(
    private store: PageStore,
    config: Record<string, any>
  ) {
    this.config = config;
    this.port = config.port || 8787;
  }

  async start(): Promise<void> {
    if (this.server) return;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.on("error", (err) => {
        this.server = null;
        reject(err);
      });

      this.server.listen(this.port, () => resolve());
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url || "/", `http://localhost:${this.port}`);
    const pathname = url.pathname.replace(/^\/+|\/+$/g, "");

    // Health check
    if (pathname === "" || pathname === "health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", pages: this.store.list().length }));
      return;
    }

    // API: list pages (JSON)
    if (pathname === "api/pages") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      const pages = this.store.list().map((p) => ({
        id: p.id,
        title: p.title,
        url: `${this.baseUrl()}/${p.id}`,
        deleted: p.deleted,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));
      res.end(JSON.stringify({ pages }));
      return;
    }

    // Serve page
    const pageId = pathname.split("/")[0];
    const page = this.store.get(pageId);

    if (!page) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(NOT_FOUND_HTML);
      return;
    }

    const body = page.deleted
      ? `<div class="deleted">${escHtml(page.title)}</div>`
      : page.html;

    const html = PAGE_TEMPLATE(
      page.title,
      body,
      page.author,
      page.lang
    );

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(html);
  }

  private baseUrl(): string {
    return (this.config.baseUrl || `http://localhost:${this.port}`).replace(/\/$/, "");
  }
}
