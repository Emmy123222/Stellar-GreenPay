/**
 * src/services/claude.js
 *
 * Thin wrapper around the Anthropic SDK for the AI project-summary feature.
 * Centralises model selection, prompt caching, and response shape so the
 * route handler stays small and the prompt template lives in one place.
 */
"use strict";

const Anthropic = require("@anthropic-ai/sdk");

// Pinned model. Change here, not at every call site.
const SUMMARY_MODEL = process.env.CLAUDE_SUMMARY_MODEL || "claude-opus-4-7";

let client = null;
function getClient() {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error("ANTHROPIC_API_KEY is not set");
    err.code = "MISSING_API_KEY";
    throw err;
  }
  client = new Anthropic({ apiKey });
  return client;
}

// Frozen system prompt — every project shares it byte-for-byte so the
// `cache_control: ephemeral` block hits the prompt cache after the first
// request. Putting per-request data (project name, description) into the
// user turn keeps the cache key stable across calls.
const SUMMARY_SYSTEM_PROMPT = [
  "You are an editor for a climate-donation platform.",
  "",
  "Given a project's name, category, and description, produce a single",
  "impact summary that a potential donor can read in under 30 seconds.",
  "",
  "Rules — follow exactly:",
  "  * Exactly three sentences.",
  "  * Sentence 1: what the project does, in plain language.",
  "  * Sentence 2: who benefits and where (people, ecosystems, region).",
  "  * Sentence 3: the concrete climate impact a donation contributes to.",
  "  * No greetings, no preamble, no markdown, no bullet points, no emoji.",
  "  * Do not invent statistics. If the description does not provide a",
  "    number, describe the impact qualitatively instead.",
  "  * Tone: clear, concrete, neutral. Avoid marketing adjectives like",
  "    'revolutionary', 'cutting-edge', 'world-class'.",
  "",
  "Return only the three sentences, separated by single spaces.",
].join("\n");

/**
 * Generate a 3-sentence donor-facing impact summary for a project.
 *
 * @param {{ name: string, category: string, description: string }} project
 * @returns {Promise<{ summary: string, model: string, usage: object }>}
 */
async function generateProjectSummary(project) {
  const anthropic = getClient();

  const userPrompt =
    `Project name: ${project.name}\n` +
    `Category: ${project.category}\n` +
    `Description:\n${project.description}`;

  const response = await anthropic.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 400,
    // Single-call summarisation: skip thinking, keep effort low so the
    // response stays in the cost/latency budget the UI promises.
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
    system: [
      {
        type: "text",
        text: SUMMARY_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock) {
    const err = new Error("Claude returned no text content");
    err.code = "EMPTY_RESPONSE";
    throw err;
  }

  return {
    summary: textBlock.text.trim(),
    model: response.model,
    usage: response.usage,
  };
}

module.exports = { generateProjectSummary, SUMMARY_MODEL };
