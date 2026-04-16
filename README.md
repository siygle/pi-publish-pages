# pi-publish-pages

[AgentGate](https://agentgate.sylee.dev/) + [Telegraph (telegra.ph)](https://telegra.ph) publishing extension for [pi](https://github.com/badlogic/pi)。

目前預設優先順序：

1. **AgentGate** — 首選，適合加密、短期分享 markdown 內容
2. **Telegraph** — 次選，作為公開頁面 fallback，並提供 update / delete / list / get

> Telegraph 本身不支援刪除，這個 extension 透過 `editPage` API 將內容清空並替換為在地化的「已刪除」提示來實現軟刪除。

## 功能

- 🔐 **AgentGate 優先發佈** — `create` 預設先嘗試 AgentGate，再 fallback 到 Telegraph
- 📝 **建立** — 將 markdown 發佈為分享頁面
- ✏️ **更新** — 修改既有 Telegraph 頁面
- 🗑️ **刪除** — Telegraph 軟刪除（清空內容，顯示在地化刪除提示）
- 📋 **列出** — 列出帳號下所有 Telegraph 頁面
- 🔍 **查詢** — 取得 Telegraph 頁面資訊
- 🌏 **多語系刪除提示** — zh-TW、zh-CN、en、ja、ko
- 🔁 **可指定 provider** — `auto` / `agentgate` / `telegraph`

## 安裝

```bash
pi install npm:pi-publish-pages
```

### AgentGate CLI 前置需求

若要使用 **AgentGate**（預設第一優先），需先安裝本機 CLI：

```bash
go install github.com/siygle/agentgate/cmd/agentgate@latest
```

安裝後請確認 `agentgate` 在你的 `PATH` 內。

> 若 extension 偵測到已設定 AgentGate 但系統中沒有 `agentgate` CLI，會顯示警告，並在 `provider=auto` 時自動 fallback 到 Telegraph。

## 設定

啟動 pi 後執行 `/pages-setup` 指令，或手動建立設定檔：

`~/.pi/publish-pages/config.json`

```json
{
  "provider_priority": ["agentgate", "telegraph"],
  "agentgate": {
    "server_url": "https://agentgate.sylee.dev",
    "passphrase": "optional-default-passphrase"
  },
  "telegraph": {
    "access_token": "YOUR_TELEGRAPH_ACCESS_TOKEN",
    "author_name": "Pi Agent"
  }
}
```

### 說明

- `provider_priority` 預設為 `agentgate`, `telegraph`
- AgentGate 發佈會透過本機 `agentgate` CLI 執行，而不是直接呼叫 HTTP API
- 若 `agentgate.passphrase` 未設定，建立頁面時會自動產生 passphrase，並在工具輸出中回傳
- 若已設定 `agentgate.server_url` 但尚未安裝 CLI，session 啟動與 `/pages-setup` 都會顯示警告
- 若只保留舊版格式：

```json
{
  "access_token": "YOUR_TELEGRAPH_ACCESS_TOKEN",
  "author_name": "Pi Agent"
}
```

仍可使用 Telegraph，相容舊設定

也會自動讀取舊的 `~/.pi/agent/schedule-config/telegraph.json` 設定。

## 使用方式

### LLM 工具

Extension 註冊了 `publish_page` 工具，LLM 可以直接呼叫：

```text
幫我把這份分析報告發佈出去
```

預設會先嘗試 AgentGate；若 AgentGate 未設定或失敗，才 fallback 到 Telegraph。

也可以指定 provider：

```text
用 AgentGate 發佈這份 markdown，並把 passphrase 一起回傳
```

```text
用 Telegraph 發佈這份文章
```

```text
刪除這個頁面：https://telegra.ph/My-Page-02-27
```

### Tool 參數

- `action`: `create` / `update` / `delete` / `list` / `get`
- `provider`: `auto` / `agentgate` / `telegraph`（預設 `auto`）
- `passphrase`: AgentGate 建立頁面時可覆蓋預設 passphrase

## 指令

```text
/pages        — 列出所有 Telegraph 頁面
/pages-setup  — 設定 AgentGate / Telegraph provider
```

## Provider 行為

### AgentGate

- 用於 `create`
- 透過本機 `agentgate` CLI 上傳
- 內容加密後上傳
- 連結預設 24 小時後過期
- 讀取時需要 passphrase
- 未安裝 CLI 時會顯示警告
- 不支援 update / delete / list / get

### Telegraph

- 用於 `create` fallback
- 支援 `update` / `delete` / `list` / `get`
- 適合公開長文頁面

## License

MIT
