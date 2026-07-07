/**
 * AgentGate client.
 * Uses the local `agentgate` CLI to upload markdown files.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { createDecipheriv, pbkdf2Sync, randomBytes } from "crypto";

const execFileAsync = promisify(execFile);

export interface AgentGateConfig {
  server_url: string;
  passphrase?: string;
  cli_path?: string;
  /** Default AgentGate TTL passed to CLI, e.g. "7d", "24h". */
  default_ttl?: string;
}

export interface AgentGateCreateResult {
  id: string;
  url: string;
  passphrase: string;
  title: string;
  filename: string;
  manageUrl?: string;
}

interface AgentGateCliResponse {
  success?: boolean;
  data?: {
    preview_url?: string;
    manage_url?: string;
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

  async createMarkdownPage(title: string, markdown: string, passphrase?: string, ttl?: string, noExpiry = false): Promise<AgentGateCreateResult> {
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

      const effectiveTtl = ttl || this.config.default_ttl || "7d";
      const cliArgs = ["files", "-s", this.serverUrl, "-p", effectivePassphrase];
      if (noExpiry) {
        cliArgs.push("--no-expiry");
      } else {
        cliArgs.push("-t", effectiveTtl);
      }
      cliArgs.push(filePath);
      const { stdout, stderr } = await execFileAsync(
        this.cliPath,
        cliArgs,
        {
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        }
      );

      const raw = `${stdout || ""}${stderr || ""}`.trim();
      const result = parseCliResponse(raw);
      if (!result.data?.preview_url) {
        throw new Error(result.error || `AgentGate CLI 回傳格式無法解析：${raw.slice(0, 300)}`);
      }

      const id = result.data.id || extractShareId(result.data.preview_url);
      if (!id) {
        throw new Error(result.error || `AgentGate CLI 回傳缺少分享 ID：${raw.slice(0, 300)}`);
      }
      const url = normalizePreviewUrl(this.serverUrl, result.data.preview_url, id);
      const manageUrl = result.data.manage_url ? normalizeManageUrl(this.serverUrl, result.data.manage_url) : undefined;
      await verifyUploadedShare(url, effectivePassphrase, filename);

      return {
        id,
        url,
        passphrase: effectivePassphrase,
        title,
        filename,
        manageUrl,
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

interface EncryptedPayloadResponse {
  salt: string;
  iv: string;
  ciphertext: string;
}

async function verifyUploadedShare(url: string, passphrase: string, expectedFilename: string): Promise<void> {
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`驗證失敗：無法讀取分享頁面 (${response.status} ${response.statusText})`);
  }

  const html = await response.text();
  const encryptedJson = extractEncryptedPayload(html);
  if (!encryptedJson) {
    // Newer AgentGate serves a loader shell and fetches/decrypts payload client-side,
    // so the encrypted payload is no longer embedded in the initial HTML.
    // A successful HTTP response is enough to confirm the share URL is reachable.
    return;
  }

  let encrypted: EncryptedPayloadResponse;
  try {
    encrypted = JSON.parse(encryptedJson) as EncryptedPayloadResponse;
  } catch {
    throw new Error("驗證失敗：無法解析 encrypted payload JSON");
  }

  if (!encrypted.salt || !encrypted.iv || !encrypted.ciphertext) {
    throw new Error("驗證失敗：encrypted payload 欄位不完整");
  }

  const payload = decryptPayload(encrypted, passphrase) as { files?: Array<{ title?: string } | null> } | null;
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const matched = files.some((file: { title?: string } | null) => file && typeof file.title === "string" && file.title === expectedFilename);
  if (!matched) {
    throw new Error(`驗證失敗：解密後內容不包含預期檔案 ${expectedFilename}`);
  }
}

function extractEncryptedPayload(html: string): string | null {
  const match = html.match(/<div\s+id=["']encrypted-data["'][^>]*data-value=["']([^"']+)["']/i);
  if (!match) return null;
  return decodeHtmlEntities(match[1]);
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function decryptPayload(encrypted: EncryptedPayloadResponse, passphrase: string): any {
  try {
    const salt = Buffer.from(encrypted.salt, "base64");
    const iv = Buffer.from(encrypted.iv, "base64");
    const sealed = Buffer.from(encrypted.ciphertext, "base64");
    const key = pbkdf2Sync(passphrase, salt, 600000, 32, "sha256");
    const tag = sealed.subarray(sealed.length - 16);
    const data = sealed.subarray(0, sealed.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return JSON.parse(plain);
  } catch (e: any) {
    throw new Error(`驗證失敗：本地解密檢查未通過 (${e?.message || "unknown error"})`);
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
  } catch {}

  const previewLine = lines.find((line) => /^Preview URL:\s*/i.test(line));
  const manageLine = lines.find((line) => /^Manage URL:\s*/i.test(line));
  const preview_url = previewLine?.replace(/^Preview URL:\s*/i, "").trim();
  const manage_url = manageLine?.replace(/^Manage URL:\s*/i, "").trim();
  const id = preview_url ? extractShareId(preview_url) : undefined;
  if (preview_url) {
    return { success: true, data: { preview_url, manage_url, id } };
  }

  throw new Error(`無法解析 AgentGate CLI 輸出：${raw.slice(0, 300)}`);
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

function normalizeManageUrl(serverUrl: string, manageUrl: string): string {
  try {
    const server = new URL(serverUrl);
    const manage = new URL(manageUrl, serverUrl);
    if (manage.hostname === "localhost" || manage.hostname === "127.0.0.1") {
      manage.protocol = server.protocol;
      manage.hostname = server.hostname;
      manage.port = server.port;
    }
    return manage.toString();
  } catch {
    return manageUrl;
  }
}

function extractShareId(url: string): string | undefined {
  try {
    const parsed = new URL(url, "http://localhost");
    const match = parsed.pathname.match(/\/(?:d|f)\/([^/?#]+)/);
    return match?.[1];
  } catch {
    const match = url.match(/\/(?:d|f)\/([^/?#]+)/);
    return match?.[1];
  }
}

function generatePassphrase(length = 12): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}
