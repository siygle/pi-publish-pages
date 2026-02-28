/**
 * Telegraph API client.
 * Wraps telegra.ph API: createPage, editPage, getPage, getPageList, createAccount.
 */

import * as https from "https";

const API_BASE = "https://api.telegra.ph";

export interface TelegraphPage {
  path: string;
  url: string;
  title: string;
  description: string;
  author_name?: string;
  content?: TelegraphNode[];
  views: number;
  can_edit?: boolean;
}

export type TelegraphNode = string | {
  tag: string;
  attrs?: Record<string, string>;
  children?: TelegraphNode[];
};

export interface TelegraphAccount {
  short_name: string;
  author_name: string;
  author_url: string;
  access_token?: string;
}

export interface TelegraphConfig {
  access_token: string;
  short_name?: string;
  author_name?: string;
}

export class TelegraphClient {
  constructor(private config: TelegraphConfig) {}

  get token(): string {
    return this.config.access_token;
  }

  get authorName(): string {
    return this.config.author_name || "Pi Agent";
  }

  async createPage(title: string, content: TelegraphNode[], author?: string): Promise<TelegraphPage> {
    return this.apiCall("createPage", {
      access_token: this.token,
      title,
      author_name: author || this.authorName,
      content,
      return_content: false,
    });
  }

  async editPage(path: string, title: string, content: TelegraphNode[], author?: string): Promise<TelegraphPage> {
    return this.apiCall("editPage", {
      access_token: this.token,
      path,
      title,
      author_name: author || this.authorName,
      content,
      return_content: false,
    });
  }

  async getPage(path: string, returnContent = false): Promise<TelegraphPage> {
    return this.apiCall("getPage", {
      path,
      return_content: returnContent,
    });
  }

  async getPageList(offset = 0, limit = 50): Promise<{ total_count: number; pages: TelegraphPage[] }> {
    return this.apiCall("getPageList", {
      access_token: this.token,
      offset,
      limit,
    });
  }

  async createAccount(shortName: string, authorName: string): Promise<TelegraphAccount> {
    return this.apiCall("createAccount", {
      short_name: shortName,
      author_name: authorName,
    });
  }

  private async apiCall(method: string, params: Record<string, any>): Promise<any> {
    const payload = JSON.stringify(params);

    return new Promise((resolve, reject) => {
      const req = https.request(
        `${API_BASE}/${method}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const result = JSON.parse(data);
              if (result.ok) {
                resolve(result.result);
              } else {
                reject(new Error(`Telegraph API error: ${result.error || JSON.stringify(result)}`));
              }
            } catch (e) {
              reject(new Error(`Failed to parse Telegraph response: ${data.slice(0, 200)}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error("Telegraph API timeout"));
      });
      req.write(payload);
      req.end();
    });
  }
}
