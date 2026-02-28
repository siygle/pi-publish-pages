/**
 * Minimal markdown-to-HTML converter.
 * No external dependencies — handles the subset we need for published pages.
 */

export function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  let inList = false;
  let listTag = "";

  const flushList = () => {
    if (inList) {
      out.push(`</${listTag}>`);
      inList = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line
    if (!trimmed) {
      flushList();
      i++;
      continue;
    }

    // Horizontal rule
    if (/^-{3,}\s*$/.test(trimmed) || /^\*{3,}\s*$/.test(trimmed)) {
      flushList();
      out.push("<hr>");
      i++;
      continue;
    }

    // Headings
    const hm = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      flushList();
      const level = hm[1].length;
      out.push(`<h${level}>${inlineMarkdown(hm[2])}</h${level}>`);
      i++;
      continue;
    }

    // Code block
    if (trimmed.startsWith("```")) {
      flushList();
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // skip closing ```
      const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      out.push(`<pre><code${langAttr}>${codeLines.join("\n")}</code></pre>`);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      flushList();
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote><p>${inlineMarkdown(quoteLines.join(" "))}</p></blockquote>`);
      continue;
    }

    // Unordered list
    const ulm = trimmed.match(/^[-*•]\s+(.*)$/);
    if (ulm) {
      if (!inList || listTag !== "ul") {
        flushList();
        out.push("<ul>");
        inList = true;
        listTag = "ul";
      }
      out.push(`<li>${inlineMarkdown(ulm[1])}</li>`);
      i++;
      continue;
    }

    // Ordered list
    const olm = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (olm) {
      if (!inList || listTag !== "ol") {
        flushList();
        out.push("<ol>");
        inList = true;
        listTag = "ol";
      }
      out.push(`<li>${inlineMarkdown(olm[2])}</li>`);
      i++;
      continue;
    }

    // Table
    if (trimmed.includes("|") && trimmed.startsWith("|")) {
      flushList();
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      out.push(parseTable(tableLines));
      continue;
    }

    // Paragraph
    flushList();
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("#") &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].trim().startsWith(">") &&
      !/^-{3,}\s*$/.test(lines[i].trim()) &&
      !/^[-*•]\s/.test(lines[i].trim()) &&
      !/^\d+\.\s/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length) {
      out.push(`<p>${inlineMarkdown(paraLines.join(" "))}</p>`);
    }
  }

  flushList();
  return out.join("\n");
}

function parseTable(lines: string[]): string {
  if (lines.length < 2) return lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n");

  const parseCells = (line: string) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const headers = parseCells(lines[0]);
  // Skip separator line (line[1] is usually |---|---|)
  const bodyStart = /^[\s|:-]+$/.test(lines[1]?.replace(/\|/g, "").trim() || "") ? 2 : 1;

  let html = "<table>\n<thead><tr>";
  for (const h of headers) {
    html += `<th>${inlineMarkdown(h)}</th>`;
  }
  html += "</tr></thead>\n<tbody>\n";

  for (let r = bodyStart; r < lines.length; r++) {
    const cells = parseCells(lines[r]);
    html += "<tr>";
    for (const c of cells) {
      html += `<td>${inlineMarkdown(c)}</td>`;
    }
    html += "</tr>\n";
  }
  html += "</tbody></table>";
  return html;
}

/**
 * Inline markdown: **bold**, *italic*, `code`, [link](url), ~~strike~~, images
 */
function inlineMarkdown(text: string): string {
  let s = escapeHtml(text);

  // Images: ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">');

  // Links: [text](url)
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );

  // Bold: **text**
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Strikethrough: ~~text~~
  s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");

  // Italic: *text* (but not inside words with *)
  s = s.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<em>$1</em>");

  // Inline code: `text`
  s = s.replace(/`([^`]+?)`/g, "<code>$1</code>");

  // Line break: two trailing spaces or explicit <br>
  s = s.replace(/ {2,}$/gm, "<br>");

  return s;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
