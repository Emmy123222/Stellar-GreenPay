/** Escape text before inserting it into the HTML string used by project updates. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isAllowedLink(value: string): boolean {
  // Browsers ignore ASCII control characters while interpreting URL schemes.
  // Reject these outright and also compact them for the scheme check so a
  // value such as `java\nscript:` cannot evade the allowlist.
  if (/[\u0000-\u0020\u007f]/.test(value)) return false;

  const compact = value.replace(/[\u0000-\u0020\u007f]/g, "");
  const scheme = compact.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
  if (!scheme || !["http", "https", "mailto"].includes(scheme)) return false;

  try {
    return new URL(value).protocol === `${scheme}:`;
  } catch {
    return false;
  }
}

/** Render the small markdown subset supported by project updates. */
export function renderMarkdown(text: string): string {
  const escaped = escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");

  return escaped
    .replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+)\)/g, (_match, label: string, href: string) => {
      if (!isAllowedLink(href)) return label;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-forest-600 hover:underline">${label}</a>`;
    })
    .replace(/\n/g, "<br />");
}
