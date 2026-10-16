/** Render the small, supported subset of Markdown used by project updates. */
export function renderMarkdown(text: string): string {
  return renderInline(text);
}

function renderInline(text: string, depth = 0): string {
  // Keep malformed, deeply nested input bounded and escaped.
  if (depth > 20) return escapeHtml(text).replace(/\n/g, "<br />");

  let html = "";
  for (let i = 0; i < text.length;) {
    if (text[i] === "[") {
      const labelEnd = text.indexOf("](", i + 1);
      const urlEnd = labelEnd < 0 ? -1 : text.indexOf(")", labelEnd + 2);
      if (labelEnd > i + 1 && urlEnd > labelEnd + 2) {
        const url = text.slice(labelEnd + 2, urlEnd).trim();
        if (isSafeHref(url)) {
          const label = text.slice(i + 1, labelEnd);
          html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="text-forest-600 hover:underline">${renderInline(label, depth + 1)}</a>`;
          i = urlEnd + 1;
          continue;
        }
      }
    }

    const marker = text.startsWith("**", i) ? "**" : text[i] === "*" ? "*" : "";
    if (marker) {
      const end = text.indexOf(marker, i + marker.length);
      if (end > i + marker.length) {
        const tag = marker === "**" ? "strong" : "em";
        html += `<${tag}>${renderInline(text.slice(i + marker.length, end), depth + 1)}</${tag}>`;
        i = end + marker.length;
        continue;
      }
    }

    if (text[i] === "\n") {
      html += "<br />";
    } else {
      html += escapeHtml(text[i]);
    }
    i += 1;
  }
  return html;
}

function isSafeHref(href: string): boolean {
  if (!href || /[\u0000-\u001f\u007f\\]/.test(href) || href.startsWith("//")) return false;
  const scheme = href.match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
  return scheme ? scheme === "http" || scheme === "https" || scheme === "mailto" : true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
