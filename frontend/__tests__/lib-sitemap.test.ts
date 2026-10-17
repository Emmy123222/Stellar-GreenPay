import { buildSitemapXml, fetchProjectIds, SITEMAP_STATIC_ROUTES } from "@/lib/sitemap";

describe("buildSitemapXml", () => {
  it("lists static routes and project detail pages", () => {
    const xml = buildSitemapXml("https://example.org/", ["p1", "a&b"]);
    expect(xml).toContain("<loc>https://example.org</loc>");
    for (const route of SITEMAP_STATIC_ROUTES.filter((r) => r !== "/")) {
      expect(xml).toContain(`<loc>https://example.org${route}</loc>`);
    }
    expect(xml).toContain("<loc>https://example.org/projects/p1</loc>");
    expect(xml).toContain("<loc>https://example.org/projects/a%26b</loc>");
  });
});

describe("fetchProjectIds", () => {
  const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalFetchDescriptor) {
      Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "fetch");
    }
  });

  it("follows cursor pagination", async () => {
    const json = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    const fetchMock = jest.fn()
      .mockImplementationOnce(() => json({ data: [{ id: "a" }], next_cursor: "c1" }) as never)
      .mockImplementationOnce(() => json({ data: [{ id: "b" }], next_cursor: null }) as never);
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
    });
    await expect(fetchProjectIds("http://api")).resolves.toEqual(["a", "b"]);
    expect(String(fetchMock.mock.calls[1][0])).toContain("cursor=c1");
  });

  it("returns an empty list when the API is unreachable", async () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: jest.fn().mockRejectedValue(new Error("down")),
    });
    await expect(fetchProjectIds("http://api")).resolves.toEqual([]);
  });
});
