# pi-publish-pages

[Telegraph (telegra.ph)](https://telegra.ph) wrapper extension for [pi](https://github.com/badlogic/pi). 發佈、更新、刪除 Telegraph 頁面。

Telegraph 本身不支援刪除，這個 extension 透過 `editPage` API 將內容清空並替換為在地化的「已刪除」提示來實現軟刪除。

## 功能

- 📝 **建立** — 將 markdown 發佈為 Telegraph 頁面
- ✏️ **更新** — 修改已有頁面的標題與內容
- 🗑️ **刪除** — 軟刪除（清空內容，顯示在地化的刪除提示）
- 📋 **列出** — 列出帳號下所有頁面
- 🔍 **查詢** — 取得頁面資訊
- 🌏 **多語系刪除提示** — zh-TW、zh-CN、en、ja、ko

## 安裝

```bash
pi install npm:pi-publish-pages
```

## 設定

啟動 pi 後執行 `/pages-setup` 指令，或手動建立設定檔：

`~/.pi/publish-pages/config.json`

```json
{
  "access_token": "YOUR_TELEGRAPH_ACCESS_TOKEN",
  "author_name": "Pi Agent"
}
```

也會自動讀取舊的 `~/.pi/agent/schedule-config/telegraph.json` 設定。

## 使用方式

### LLM 工具

Extension 註冊了 `publish_page` 工具，LLM 可以直接呼叫：

```
幫我把這份分析報告發佈到 Telegraph。
```

```
刪除這個頁面：https://telegra.ph/My-Page-02-27
```

### 指令

```
/pages        — 列出所有 Telegraph 頁面
/pages-setup  — 設定 Telegraph access token
```

## License

MIT
