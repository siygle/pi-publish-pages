# pi-publish-pages

Self-hosted Telegraph alternative for [pi](https://github.com/badlogic/pi). Publish markdown pages to a URL with full CRUD support — including **delete** (which Telegraph doesn't support).

## Features

- 📝 **Create** — publish markdown as a styled web page
- ✏️ **Update** — modify title and content of existing pages
- 🗑️ **Delete** — soft-delete pages (content replaced with localized "Deleted" notice)
- 📋 **List** — view all published pages
- 🌓 **Dark mode** — automatic dark/light theme based on system preference
- 🌏 **i18n** — delete notices in zh-TW, zh-CN, en, ja, ko
- 🔗 **Standalone script** — `scripts/publish.sh` for use in cron jobs and other skills

## Install

```bash
pi install npm:pi-publish-pages
```

## Configuration

Config file: `~/.pi/publish-pages/config.json`

```json
{
  "port": 8787,
  "baseUrl": "https://pages.example.com",
  "autoStart": true
}
```

- `port` — HTTP server port (default: `8787`)
- `baseUrl` — Public URL prefix for generated links. If empty, uses `http://localhost:{port}`
- `autoStart` — Start the server automatically when pi starts (default: `true`)

### Reverse Proxy (Traefik / Nginx)

To serve pages at a public URL, set up a reverse proxy to `localhost:8787` and update `baseUrl` in config.

## Usage

### As a pi tool (LLM-callable)

The extension registers a `publish_page` tool that the LLM can call:

```
Please publish this analysis report as a web page.
```

### As a command

```
/pages        — list all published pages
/pages-server — show server status
```

### Standalone script (for cron jobs / other skills)

```bash
# Publish
./scripts/publish.sh "Page Title" /path/to/report.md
# Output: http://localhost:8787/260228-a1b2c3d4

# Delete
./scripts/publish.sh --delete 260228-a1b2c3d4

# List
./scripts/publish.sh --list
```

## Replacing Telegraph in existing skills

Replace the Telegraph publish step with:

```bash
# Before (Telegraph)
python3 publish-telegraph.py "$TITLE" "$MD_FILE"

# After (pi-publish-pages)
/path/to/pi-publish-pages/scripts/publish.sh "$TITLE" "$MD_FILE"
```

Both output the page URL to stdout.

## API

The server exposes a simple JSON API:

- `GET /` — health check
- `GET /api/pages` — list all pages (JSON)
- `GET /:id` — view a page (HTML)

## Storage

Pages are stored as JSON files in `~/.pi/publish-pages/pages/`. Each page file contains the title, original markdown, rendered HTML, and metadata. Soft-deleted pages retain their file but content is replaced with a localized notice.

## License

MIT
