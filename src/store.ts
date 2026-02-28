/**
 * Page storage — JSON files on disk under pages/<id>.json
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export interface PageData {
  id: string;
  title: string;
  markdown: string;
  html: string;
  author?: string;
  lang: string;
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PageMeta {
  id: string;
  title: string;
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreatePageInput {
  title: string;
  markdown: string;
  author?: string;
  lang?: string;
}

export interface UpdatePageInput {
  title?: string;
  markdown?: string;
  author?: string;
  lang?: string;
}

const DELETED_NOTICES: Record<string, string> = {
  "zh-TW": "此頁面已刪除。",
  "zh-CN": "此页面已删除。",
  en: "This page has been deleted.",
  ja: "このページは削除されました。",
  ko: "이 페이지는 삭제되었습니다.",
};

function getDeletedNotice(lang: string): string {
  return DELETED_NOTICES[lang] || DELETED_NOTICES["zh-TW"];
}

export class PageStore {
  private pagesDir: string;

  constructor(private dataDir: string) {
    this.pagesDir = path.join(dataDir, "pages");
  }

  init(): void {
    fs.mkdirSync(this.pagesDir, { recursive: true });
  }

  /**
   * Generate a short, URL-friendly ID.
   * Format: 8-char hex from a random UUID, prefixed with date for easy sorting.
   */
  private generateId(): string {
    const date = new Date().toISOString().slice(2, 10).replace(/-/g, ""); // YYMMDD
    const rand = crypto.randomBytes(4).toString("hex"); // 8 hex chars
    return `${date}-${rand}`;
  }

  private pagePath(id: string): string {
    // Prevent directory traversal
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
    return path.join(this.pagesDir, `${safe}.json`);
  }

  private read(id: string): PageData | null {
    const p = this.pagePath(id);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch {
      return null;
    }
  }

  private write(page: PageData): void {
    fs.writeFileSync(this.pagePath(page.id), JSON.stringify(page, null, 2), "utf-8");
  }

  create(input: CreatePageInput): PageData {
    const { markdownToHtml } = require("./md.js");
    const id = this.generateId();
    const now = Date.now();
    const lang = input.lang || "zh-TW";
    const html = markdownToHtml(input.markdown);
    const page: PageData = {
      id,
      title: input.title,
      markdown: input.markdown,
      html,
      author: input.author,
      lang,
      deleted: false,
      createdAt: now,
      updatedAt: now,
    };
    this.write(page);
    return page;
  }

  update(id: string, input: UpdatePageInput): PageData | null {
    const page = this.read(id);
    if (!page) return null;
    const { markdownToHtml } = require("./md.js");

    if (input.title !== undefined) page.title = input.title;
    if (input.markdown !== undefined) {
      page.markdown = input.markdown;
      page.html = markdownToHtml(input.markdown);
    }
    if (input.author !== undefined) page.author = input.author;
    if (input.lang !== undefined) page.lang = input.lang;
    page.deleted = false; // un-delete if updating
    page.updatedAt = Date.now();
    this.write(page);
    return page;
  }

  /**
   * Soft-delete: replace content with a "deleted" notice, keep the page file.
   */
  softDelete(id: string, lang?: string): PageData | null {
    const page = this.read(id);
    if (!page) return null;

    const pageLang = lang || page.lang || "zh-TW";
    const notice = getDeletedNotice(pageLang);
    page.title = notice;
    page.markdown = notice;
    page.html = `<p>${notice}</p>`;
    page.deleted = true;
    page.updatedAt = Date.now();
    this.write(page);
    return page;
  }

  get(id: string): PageData | null {
    return this.read(id);
  }

  list(): PageMeta[] {
    if (!fs.existsSync(this.pagesDir)) return [];
    const files = fs.readdirSync(this.pagesDir).filter((f) => f.endsWith(".json"));
    const pages: PageMeta[] = [];
    for (const f of files) {
      try {
        const raw = JSON.parse(
          fs.readFileSync(path.join(this.pagesDir, f), "utf-8")
        );
        pages.push({
          id: raw.id,
          title: raw.title,
          deleted: raw.deleted ?? false,
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
        });
      } catch {}
    }
    pages.sort((a, b) => b.createdAt - a.createdAt);
    return pages;
  }
}
