/**
 * AgentGate client.
 * Uses the local `agentgate` CLI to upload markdown files.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { randomBytes } from "crypto";

const execFileAsync = promisify(execFile);

export interface AgentGateConfig {
  server_url: string;
  passphrase?: string;
  cli_path?: string;
}

export interface AgentGateCreateResult {
  id: string;
  url: string;
  passphrase: string;
  title: string;
  filename: string;
}

interface AgentGateCliResponse {
  success?: boolean;
  data?: {
    preview_url?: string;
    id?: string;
  };
  error?: string;
}

export class AgentGateClient {
  constructor(private config: AgentGateConfig) {}

  get serverUrl(): string {
    return this.config.server_url.replace(/\/+$/, "");
  }

  get defaultPassphrase(): string | undefined {
    return this.config.passphrase;
  }

  get cliPath(): string {
    return this.config.cli_path || "agentgate";
  }

  async isCliInstalled(): Promise<boolean> {
    try {
      await execFileAsync(this.cliPath, [], { timeout: 5000 });
      return true;
    } catch (e: any) {
      const code = typeof e?.code === "number" ? e.code : undefined;
      if (e?.code === "ENOENT") return false;
      // exit code 1 with usage output still means installed
      if (code && code !== 0) return true;
      if (typeof e?.stdout === "string" || typeof e?.stderr === "string") return true;
      return false;
    }
  }

  async createMarkdownPage(title: string, markdown: string, passphrase?: string): Promise<AgentGateCreateResult> {
    const installed = await this.isCliInstalled();
    if (!installed) {
      throw new Error(
        "找不到 AgentGate CLI。請先安裝 `agentgate`，例如：`go install github.com/siygle/agentgate/cmd/agentgate@latest`"
      );
    }

    const effectivePassphrase = passphrase || this.defaultPassphrase || generatePassphrase();
    const filename = `${slugify(title) || "page"}.md`;
    const content = ensureTitleHeading(title, markdown);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-publish-pages-"));
    const filePath = path.join(tempDir, filename);

    try {
      await fs.writeFile(filePath, content, "utf8");

      const { stdout, stderr } = await execFileAsync(
        this.cliPath,
        ["files", "-s", this.serverUrl, "-p", effectivePassphrase, filePath],
        {
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        }
      );

      const raw = `${stdout || ""}${stderr || ""}`.trim();
      const result = parseCliResponse(raw);
      if (!result.data?.id || !result.data?.preview_url) {
        throw new Error(result.error || `AgentGate CLI 回傳格式無法解析：${raw.slice(0, 300)}`);
      }

      return {
        id: result.data.id,
        url: normalizePreviewUrl(this.serverUrl, result.data.preview_url, result.data.id),
        passphrase: effectivePassphrase,
        title,
        filename,
      };
    } catch (e: any) {
      if (e?.code === "ENOENT") {
        throw new Error(
          "找不到 AgentGate CLI。請先安裝 `agentgate`，例如：`go install github.com/siygle/agentgate/cmd/agentgate@latest`"
        );
      }
      const output = `${e?.stdout || ""}\n${e?.stderr || ""}`.trim();
      throw new Error(output || e?.message || "AgentGate CLI 執行失敗");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

function parseCliResponse(raw: string): AgentGateCliResponse {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]) as AgentGateCliResponse;
    } catch {}
  }

  try {
    return JSON.parse(raw) as AgentGateCliResponse;
  } catch {
    throw new Error(`無法解析 AgentGate CLI 輸出：${raw.slice(0, 300)}`);
  }
}

function ensureTitleHeading(title: string, markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return `# ${title}`;
  if (trimmed.startsWith("# ")) return markdown;
  return `# ${title}\n\n${markdown}`;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizePreviewUrl(serverUrl: string, previewUrl: string, id: string): string {
  try {
    const server = new URL(serverUrl);
    const preview = new URL(previewUrl, serverUrl);
    if (preview.hostname === "localhost" || preview.hostname === "127.0.0.1") {
      preview.protocol = server.protocol;
      preview.hostname = server.hostname;
      preview.port = server.port;
    }
    return preview.toString();
  } catch {
    return `${serverUrl.replace(/\/+$/, "")}/f/${id}`;
  }
}

function generatePassphrase(length = 12): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}
