import { renderMarkdown } from "@/lib/renderMarkdown";

describe("renderMarkdown", () => {
  it("escapes HTML before rendering supported formatting", () => {
    expect(renderMarkdown("<script>alert('x')</script> & **safe**"))
      .toBe("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; <strong>safe</strong>");
  });

  it("renders bold, italic, links, and line breaks", () => {
    expect(renderMarkdown("**bold** *italic* [site](https://example.com)\nnext"))
      .toBe('<strong>bold</strong> <em>italic</em> <a href="https://example.com" target="_blank" rel="noopener noreferrer" class="text-forest-600 hover:underline">site</a><br />next');
  });

  it("supports nested emphasis", () => {
    expect(renderMarkdown("**a *b* c**")).toBe("<strong>a <em>b</em> c</strong>");
  });

  it("leaves malformed markup visible and escaped", () => {
    expect(renderMarkdown("**open <tag> [label](https://example.com"))
      .toBe("**open &lt;tag&gt; [label](https://example.com");
  });

  it("does not create links with unsafe schemes", () => {
    expect(renderMarkdown("[bad](javascript:alert(1)) [good](mailto:team@example.com)"))
      .toBe('[bad](javascript:alert(1)) <a href="mailto:team@example.com" target="_blank" rel="noopener noreferrer" class="text-forest-600 hover:underline">good</a>');
  });
});
