const mockCreate = jest.fn();
const mockAnthropic = jest.fn().mockImplementation((opts) => ({ messages: { create: mockCreate }, _opts: opts }));
mockAnthropic.__create = mockCreate;

jest.mock("@anthropic-ai/sdk", () => {
  return mockAnthropic;
});

const Anthropic = require("@anthropic-ai/sdk");

const ENV_KEYS = ["ANTHROPIC_API_KEY", "CLAUDE_SUMMARY_MODEL"];
const SAVED_ENV = {};
beforeAll(() => ENV_KEYS.forEach((k) => { SAVED_ENV[k] = process.env[k]; }));
afterAll(() => Object.entries(SAVED_ENV).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

function loadClaude() {
  jest.resetModules();
  return require("./claude");
}

function apiResponse(overrides = {}) {
  return {
    model: "claude-opus-4-7",
    usage: { input_tokens: 120, output_tokens: 60 },
    content: [{ type: "text", text: "Sentence one. Sentence two. Sentence three." }],
    ...overrides,
  };
}

const PROJECT = {
  name: "Mangrove Restoration",
  category: "Reforestation",
  description: "Planting mangroves along the coast to sequester carbon.",
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CLAUDE_SUMMARY_MODEL;
});

describe("generateProjectSummary - request shape", () => {
  test("constructs the client with the API key from env", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    Anthropic.__create.mockResolvedValueOnce(apiResponse());
    const { generateProjectSummary } = loadClaude();
    await generateProjectSummary(PROJECT);
    expect(Anthropic).toHaveBeenCalledWith({ apiKey: "sk-ant-test-key" });
  });

  test("single user message with name, category, description", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    Anthropic.__create.mockResolvedValueOnce(apiResponse());
    const { generateProjectSummary } = loadClaude();
    await generateProjectSummary(PROJECT);
    const req = Anthropic.__create.mock.calls[0][0];
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe("user");
    expect(req.messages[0].content).toContain("Mangrove Restoration");
    expect(req.messages[0].content).toContain("Reforestation");
    expect(req.messages[0].content).toContain("Planting mangroves");
  });

  test("system prompt has ephemeral cache_control", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    Anthropic.__create.mockResolvedValueOnce(apiResponse());
    const { generateProjectSummary } = loadClaude();
    await generateProjectSummary(PROJECT);
    const req = Anthropic.__create.mock.calls[0][0];
    expect(req.system[0]).toMatchObject({ type: "text", cache_control: { type: "ephemeral" } });
    expect(req.system[0].text).toMatch(/three sentences/i);
  });

  test("pinned model and low-effort settings", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    Anthropic.__create.mockResolvedValueOnce(apiResponse());
    const { generateProjectSummary, SUMMARY_MODEL } = loadClaude();
    await generateProjectSummary(PROJECT);
    const req = Anthropic.__create.mock.calls[0][0];
    expect(req.model).toBe(SUMMARY_MODEL);
    expect(req.model).toBe("claude-opus-4-7");
    expect(req.max_tokens).toBe(400);
    expect(req.thinking).toEqual({ type: "disabled" });
    expect(req.output_config).toEqual({ effort: "low" });
  });

  test("CLAUDE_SUMMARY_MODEL overrides the default", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    process.env.CLAUDE_SUMMARY_MODEL = "claude-sonnet-4-6";
    Anthropic.__create.mockResolvedValueOnce(apiResponse({ model: "claude-sonnet-4-6" }));
    const { generateProjectSummary, SUMMARY_MODEL } = loadClaude();
    await generateProjectSummary(PROJECT);
    expect(SUMMARY_MODEL).toBe("claude-sonnet-4-6");
    expect(Anthropic.__create.mock.calls[0][0].model).toBe("claude-sonnet-4-6");
  });
});

describe("generateProjectSummary - response parsing", () => {
  test("returns trimmed text + model + usage", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    Anthropic.__create.mockResolvedValueOnce(apiResponse({ content: [{ type: "text", text: "  One. Two. Three.  " }] }));
    const { generateProjectSummary } = loadClaude();
    expect(await generateProjectSummary(PROJECT)).toEqual({
      summary: "One. Two. Three.",
      model: "claude-opus-4-7",
      usage: { input_tokens: 120, output_tokens: 60 },
    });
  });

  test("picks the first text block out of mixed content", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    Anthropic.__create.mockResolvedValueOnce(apiResponse({
      content: [{ type: "tool_use", id: "x", name: "noop", input: {} }, { type: "text", text: "Real summary." }],
    }));
    const { generateProjectSummary } = loadClaude();
    expect((await generateProjectSummary(PROJECT)).summary).toBe("Real summary.");
  });

  test("EMPTY_RESPONSE when no text block", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    Anthropic.__create.mockResolvedValueOnce(apiResponse({ content: [{ type: "tool_use", id: "x", name: "noop", input: {} }] }));
    const { generateProjectSummary } = loadClaude();
    await expect(generateProjectSummary(PROJECT)).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
  });

  test("EMPTY_RESPONSE when content is empty or missing", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    const { generateProjectSummary } = loadClaude();
    Anthropic.__create.mockResolvedValueOnce(apiResponse({ content: [] }));
    await expect(generateProjectSummary(PROJECT)).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
    Anthropic.__create.mockResolvedValueOnce({ model: "claude-opus-4-7" });
    await expect(generateProjectSummary(PROJECT)).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
  });
});

describe("generateProjectSummary - missing ANTHROPIC_API_KEY", () => {
  test("throws MISSING_API_KEY without constructing a client", async () => {
    const { generateProjectSummary } = loadClaude();
    await expect(generateProjectSummary(PROJECT)).rejects.toMatchObject({ code: "MISSING_API_KEY" });
    expect(Anthropic).not.toHaveBeenCalled();
    expect(Anthropic.__create).not.toHaveBeenCalled();
  });

  test("blank key is treated as missing", async () => {
    process.env.ANTHROPIC_API_KEY = "   ";
    const { generateProjectSummary } = loadClaude();
    await expect(generateProjectSummary(PROJECT)).rejects.toMatchObject({ code: "MISSING_API_KEY" });
  });

  test("error is re-thrown on every call, no cached partial client", async () => {
    const { generateProjectSummary } = loadClaude();
    await expect(generateProjectSummary(PROJECT)).rejects.toMatchObject({ code: "MISSING_API_KEY" });
    await expect(generateProjectSummary(PROJECT)).rejects.toMatchObject({ code: "MISSING_API_KEY" });
    expect(Anthropic).not.toHaveBeenCalled();
  });
});

describe("generateProjectSummary - API errors", () => {
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = "sk-ant-test-key"; });

  test("SDK error propagates so callers fail safe", async () => {
    Anthropic.__create.mockRejectedValueOnce(new Error("connection reset"));
    const { generateProjectSummary } = loadClaude();
    await expect(generateProjectSummary(PROJECT)).rejects.toThrow(/connection reset/);
  });

  test("429 surfaces status to caller", async () => {
    Anthropic.__create.mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }));
    const { generateProjectSummary } = loadClaude();
    await expect(generateProjectSummary(PROJECT)).rejects.toMatchObject({ status: 429 });
  });

  test("client is memoised: second call reuses instance", async () => {
    Anthropic.__create.mockResolvedValue(apiResponse());
    const { generateProjectSummary } = loadClaude();
    await generateProjectSummary(PROJECT);
    await generateProjectSummary(PROJECT);
    expect(Anthropic).toHaveBeenCalledTimes(1);
    expect(Anthropic.__create).toHaveBeenCalledTimes(2);
  });

  test("failed request does not corrupt memoised client", async () => {
    Anthropic.__create
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(apiResponse({ content: [{ type: "text", text: "ok." }] }));
    const { generateProjectSummary } = loadClaude();
    await expect(generateProjectSummary(PROJECT)).rejects.toThrow(/transient/);
    expect((await generateProjectSummary(PROJECT)).summary).toBe("ok.");
    expect(Anthropic).toHaveBeenCalledTimes(1);
  });
});

describe("claude module exports", () => {
  test("exposes generateProjectSummary and SUMMARY_MODEL", () => {
    const claude = loadClaude();
    expect(typeof claude.generateProjectSummary).toBe("function");
    expect(claude.SUMMARY_MODEL).toBe("claude-opus-4-7");
  });
});