#!/bin/bash
# Publish a markdown file as a page (Telegraph replacement).
# Usage: ./publish.sh <title> <markdown_file>
#        ./publish.sh --delete <page_id>
#        ./publish.sh --list
#
# Output: Page URL (printed to stdout on success)
#
# Config: reads from ~/.pi/publish-pages/config.json
# Pages stored in: ~/.pi/publish-pages/pages/

set -euo pipefail

DATA_DIR="$HOME/.pi/publish-pages"
PAGES_DIR="$DATA_DIR/pages"
CONFIG_FILE="$DATA_DIR/config.json"

mkdir -p "$PAGES_DIR"

# Read config
BASE_URL=""
if [ -f "$CONFIG_FILE" ]; then
    BASE_URL=$(python3 -c "
import json
with open('$CONFIG_FILE') as f:
    c = json.load(f)
print(c.get('baseUrl', '') or f\"http://localhost:{c.get('port', 8787)}\")
" 2>/dev/null || echo "http://localhost:8787")
fi
BASE_URL="${BASE_URL%/}"

generate_id() {
    local date_part=$(date -u +%y%m%d)
    local rand_part=$(openssl rand -hex 4)
    echo "${date_part}-${rand_part}"
}

publish_page() {
    local title="$1"
    local md_file="$2"
    local id=$(generate_id)
    local now=$(date +%s)000

    # Read markdown
    local markdown
    markdown=$(cat "$md_file")

    # Convert markdown to HTML using Python
    local html
    html=$(python3 -c "
import sys, re

def escape_html(text):
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\"', '&quot;')

def inline_md(text):
    s = escape_html(text)
    s = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', r'<img src=\"\2\" alt=\"\1\" style=\"max-width:100%\">', s)
    s = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href=\"\2\" target=\"_blank\">\1</a>', s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'~~(.+?)~~', r'<del>\1</del>', s)
    s = re.sub(r'(?<!\w)\*([^*]+?)\*(?!\w)', r'<em>\1</em>', s)
    s = re.sub(r'\x60([^\x60]+?)\x60', r'<code>\1</code>', s)
    return s

lines = sys.stdin.read().split('\n')
out = []
i = 0
while i < len(lines):
    line = lines[i].strip()
    if not line:
        i += 1
        continue
    if re.match(r'^-{3,}\s*$', line):
        out.append('<hr>')
        i += 1
        continue
    hm = re.match(r'^(#{1,6})\s+(.+)$', line)
    if hm:
        lvl = len(hm.group(1))
        out.append(f'<h{lvl}>{inline_md(hm.group(2))}</h{lvl}>')
        i += 1
        continue
    if line.startswith('\x60\x60\x60'):
        lang = line[3:].strip()
        code_lines = []
        i += 1
        while i < len(lines) and not lines[i].strip().startswith('\x60\x60\x60'):
            code_lines.append(escape_html(lines[i]))
            i += 1
        i += 1
        lang_attr = f' class=\"language-{escape_html(lang)}\"' if lang else ''
        out.append(f'<pre><code{lang_attr}>{chr(10).join(code_lines)}</code></pre>')
        continue
    if line.startswith('>'):
        q = []
        while i < len(lines) and lines[i].strip().startswith('>'):
            q.append(re.sub(r'^>\s?', '', lines[i].strip()))
            i += 1
        out.append(f'<blockquote><p>{inline_md(\" \".join(q))}</p></blockquote>')
        continue
    ulm = re.match(r'^[-*•]\s+(.*)$', line)
    if ulm:
        out.append('<ul>')
        while i < len(lines) and re.match(r'^[-*•]\s+', lines[i].strip()):
            m = re.match(r'^[-*•]\s+(.*)$', lines[i].strip())
            out.append(f'<li>{inline_md(m.group(1))}</li>')
            i += 1
        out.append('</ul>')
        continue
    olm = re.match(r'^(\d+)\.\s+(.*)$', line)
    if olm:
        out.append('<ol>')
        while i < len(lines) and re.match(r'^\d+\.\s+', lines[i].strip()):
            m = re.match(r'^\d+\.\s+(.*)$', lines[i].strip())
            out.append(f'<li>{inline_md(m.group(1))}</li>')
            i += 1
        out.append('</ol>')
        continue
    # Table
    if '|' in line and line.startswith('|'):
        rows = []
        while i < len(lines) and lines[i].strip().startswith('|'):
            rows.append(lines[i].strip())
            i += 1
        if len(rows) >= 2:
            cells = lambda r: [c.strip() for c in r.strip('|').split('|')]
            out.append('<table><thead><tr>')
            for c in cells(rows[0]):
                out.append(f'<th>{inline_md(c)}</th>')
            out.append('</tr></thead><tbody>')
            start = 2 if re.match(r'^[\s|:-]+$', rows[1].replace('|','').strip()) else 1
            for r in rows[start:]:
                out.append('<tr>')
                for c in cells(r):
                    out.append(f'<td>{inline_md(c)}</td>')
                out.append('</tr>')
            out.append('</tbody></table>')
        continue
    # Paragraph
    para = []
    while i < len(lines) and lines[i].strip() and not lines[i].strip().startswith('#') and not lines[i].strip().startswith('\x60\x60\x60'):
        para.append(lines[i].strip())
        i += 1
    if para:
        out.append(f'<p>{inline_md(\" \".join(para))}</p>')

print('\n'.join(out))
" <<< "$markdown" 2>/dev/null)

    # Write page JSON
    python3 -c "
import json, sys
page = {
    'id': '$id',
    'title': sys.argv[1],
    'markdown': sys.argv[2],
    'html': sys.argv[3],
    'author': 'Pi Agent',
    'lang': 'zh-TW',
    'deleted': False,
    'createdAt': $now,
    'updatedAt': $now
}
with open('$PAGES_DIR/$id.json', 'w') as f:
    json.dump(page, f, ensure_ascii=False, indent=2)
" "$title" "$markdown" "$html"

    echo "${BASE_URL}/${id}"
}

delete_page() {
    local page_id="$1"
    local page_file="$PAGES_DIR/${page_id}.json"

    if [ ! -f "$page_file" ]; then
        echo "Error: Page not found: $page_id" >&2
        exit 1
    fi

    python3 -c "
import json, time
with open('$page_file') as f:
    page = json.load(f)
notice = '此頁面已刪除。'
page['title'] = notice
page['markdown'] = notice
page['html'] = f'<p>{notice}</p>'
page['deleted'] = True
page['updatedAt'] = int(time.time() * 1000)
with open('$page_file', 'w') as f:
    json.dump(page, f, ensure_ascii=False, indent=2)
"
    echo "Page deleted: ${BASE_URL}/${page_id}"
}

list_pages() {
    python3 -c "
import json, os, glob
pages = []
for f in sorted(glob.glob('$PAGES_DIR/*.json'), reverse=True):
    try:
        with open(f) as fh:
            p = json.load(fh)
        status = '❌' if p.get('deleted') else '✅'
        print(f\"{status} {p['id']}  {p['title']}\")
    except:
        pass
if not pages and not glob.glob('$PAGES_DIR/*.json'):
    print('No published pages.')
"
}

# Main
case "${1:-}" in
    --delete)
        [ -z "${2:-}" ] && { echo "Usage: $0 --delete <page_id>" >&2; exit 1; }
        delete_page "$2"
        ;;
    --list)
        list_pages
        ;;
    *)
        [ $# -lt 2 ] && { echo "Usage: $0 <title> <markdown_file>" >&2; echo "       $0 --delete <page_id>" >&2; echo "       $0 --list" >&2; exit 1; }
        publish_page "$1" "$2"
        ;;
esac
