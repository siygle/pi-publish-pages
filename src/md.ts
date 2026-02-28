/**
 * Markdown → Telegraph Node[] converter.
 * Converts markdown to Telegraph's native node format for the API.
 */

import type { TelegraphNode } from "./telegraph.js";

export function markdownToNodes(md: string): TelegraphNode[] {
  const lines = md.trim().split("\n");
  const nodes: TelegraphNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line
    if (!trimmed) {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^-{3,}\s*$/.test(trimmed) || /^\*{3,}\s*$/.test(trimmed)) {
      nodes.push({ tag: "hr" });
      i++;
      continue;
    }

    // Headings
    const hm = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      const level = hm[1].length;
      const tag = level <= 2 ? "h3" : "h4";
      nodes.push({ tag, children: parseInline(hm[2]) });
      i++;
      continue;
    }

    // Code block
    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      nodes.push({ tag: "pre", children: [codeLines.join("\n")] });
      continue;
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      nodes.push({
        tag: "blockquote",
        children: parseInline(quoteLines.join(" ")),
      });
      continue;
    }

    // List items (unordered or ordered)
    if (/^(\d+\.|[-*•])\s/.test(trimmed)) {
      while (i < lines.length) {
        const l = lines[i].trim();
        const lm = l.match(/^(\d+\.|[-*•])\s+(.*)$/);
        if (lm) {
          nodes.push({ tag: "p", children: parseInline(lm[2]) });
        } else if (l.startsWith("   ") || l.startsWith("\t")) {
          // continuation of previous item — skip
        } else if (l === "") {
          i++;
          break;
        } else {
          break;
        }
        i++;
      }
      continue;
    }

    // Table — convert to text representation (Telegraph doesn't support tables natively)
    if (trimmed.includes("|") && trimmed.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const row = lines[i].trim();
        // Skip separator rows
        if (!/^[\s|:-]+$/.test(row.replace(/\|/g, "").trim())) {
          tableLines.push(row);
        }
        i++;
      }
      for (const row of tableLines) {
        const cells = row
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
        nodes.push({ tag: "p", children: parseInline(cells.join(" | ")) });
      }
      continue;
    }

    // Regular paragraph
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
      nodes.push({ tag: "p", children: parseInline(paraLines.join("\n")) });
    }
  }

  return nodes;
}

/**
 * Parse inline markdown: **bold**, *italic*, `code`, [link](url)
 */
function parseInline(text: string): TelegraphNode[] {
  const result: TelegraphNode[] = [];
  let pos = 0;

  const pattern = /(\*\*(.+?)\*\*)|(\*([^*]+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))/g;

  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > pos) {
      result.push(text.slice(pos, m.index));
    }

    if (m[2]) {
      result.push({ tag: "strong", children: [m[2]] });
    } else if (m[4]) {
      result.push({ tag: "em", children: [m[4]] });
    } else if (m[6]) {
      result.push({ tag: "code", children: [m[6]] });
    } else if (m[8] && m[9]) {
      result.push({ tag: "a", attrs: { href: m[9] }, children: [m[8]] });
    }

    pos = m.index + m[0].length;
  }

  if (pos < text.length) {
    result.push(text.slice(pos));
  }

  return result.length ? result : [text];
}
