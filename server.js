require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { GoogleGenAI } = require("@google/genai");

const app = express();

// When deployed behind a host's proxy (Render, Railway, etc.), this lets
// rate limiting see each visitor's real IP instead of the proxy's.
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json());

// Limit each visitor to 15 messages per minute so nobody can spam the
// endpoint and burn through your Gemini API quota.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
});

// Serve only the chat UI — NOT the whole folder (that would expose .env)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Gives RachitAI a consistent identity / behavior, like a real assistant
const SYSTEM_PROMPT = `You are RachitAI, a helpful, friendly, and knowledgeable AI assistant.
Answer clearly and conversationally. Use Markdown (headings, **bold**, lists, and code
blocks) when it makes the answer easier to read. Keep responses concise unless the user
asks for depth.`;

// Only send the most recent messages to keep token usage (and cost) in check.
const MAX_HISTORY = 20;

// Convert the chat history from the frontend into Gemini's "contents" format.
// Accepts either { history: [{role, content}, ...] } or the old { message: "..." }.
function buildContents(body) {
  if (Array.isArray(body.history) && body.history.length > 0) {
    let contents = body.history
      .filter((m) => m && m.content)
      .map((m) => ({
        role: m.role === "ai" || m.role === "model" ? "model" : "user",
        parts: [{ text: String(m.content) }],
      }));

    // Keep only the latest messages...
    if (contents.length > MAX_HISTORY) {
      contents = contents.slice(-MAX_HISTORY);
    }
    // ...but Gemini requires the conversation to start with a user message.
    while (contents.length && contents[0].role !== "user") {
      contents.shift();
    }
    return contents;
  }
  return [{ role: "user", parts: [{ text: String(body.message || "") }] }];
}

app.post("/chat", chatLimiter, async (req, res) => {
  // Stream the reply back token-by-token using Server-Sent Events.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    const contents = buildContents(req.body);

    const stream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents,
      config: { systemInstruction: SYSTEM_PROMPT },
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error(error);
    res.write(`data: ${JSON.stringify({ error: "Something went wrong!" })}\n\n`);
    res.end();
  }
});

// Hosting platforms tell us which port to use via process.env.PORT.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RachitAI server running on http://localhost:${PORT}`);
});
