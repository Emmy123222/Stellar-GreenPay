import { renderMarkdown } from "@/utils/renderMarkdown";

describe("renderMarkdown links", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "java\nscript:alert(1)",
    "java\tscript:alert(1)",
    "javascript%3Aalert(1)",
    "java&#x73;cript:alert(1)",
  ])("renders unsafe URL %s as plain label text", (url) => {
    expect(renderMarkdown(`[click me](${url})`)).toBe("click me");
  });

  it.each([
    "https://example.com/path?a=1&b=2",
    "http://example.com",
    "mailto:hello@example.com",
  ])("keeps allowed URL %s as a link", (url) => {
    const rendered = renderMarkdown(`[visit](${url})`);
    expect(rendered).toContain('<a href="');
    expect(rendered).toContain('target="_blank"');
    expect(rendered).toContain(">visit</a>");
  });

  it("escapes HTML in the label and URL", () => {
    expect(renderMarkdown('[<img src=x onerror="x">](https://example.com/?a="x")')).toContain(
      "&lt;img src=x onerror=&quot;x&quot;&gt;",
    );
    expect(renderMarkdown('[visit](https://example.com/?a="x")')).toContain(
      "https://example.com/?a=&quot;x&quot;",
    );
  });
});
