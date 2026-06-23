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
// Allow larger bodies so users can attach images (base64 can be a few MB).
app.use(express.json({ limit: "12mb" }));

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

// Public site address — used by the SEO files below.
const SITE_URL = process.env.SITE_URL || "https://rachitgpt.onrender.com";

// Tells search engines they may crawl the whole site, and where the sitemap is.
app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(
    `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`
  );
});

// Lists the page(s) for Google to index.
app.get("/sitemap.xml", (req, res) => {
  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`
  );
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

// Turn a message's optional image (a "data:...;base64,..." URL) into a
// Gemini inline-data part. Returns null if there's no valid image.
function imagePart(image) {
  if (typeof image !== "string" || !image.startsWith("data:")) return null;
  const match = image.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return null;
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

// Convert the chat history from the frontend into Gemini's "contents" format.
// Accepts { history: [{role, content, image?}, ...] } or the old { message }.
function buildContents(body) {
  if (Array.isArray(body.history) && body.history.length > 0) {
    let contents = body.history
      .filter((m) => m && (m.content || m.image))
      .map((m) => {
        const parts = [];
        const img = imagePart(m.image);
        if (img) parts.push(img);
        if (m.content) parts.push({ text: String(m.content) });
        if (parts.length === 0) parts.push({ text: "" });
        return {
          role: m.role === "ai" || m.role === "model" ? "model" : "user",
          parts,
        };
      });

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

const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.post("/chat", chatLimiter, async (req, res) => {
  // Stream the reply back token-by-token using Server-Sent Events.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const contents = buildContents(req.body);

  // The Gemini API occasionally returns a transient error (e.g. "model
  // overloaded"). Retry a few times — but only while we haven't sent any
  // text yet, so we never duplicate a partially-streamed reply.
  let wroteAny = false;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !wroteAny; attempt++) {
    try {
      const stream = await ai.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents,
        config: { systemInstruction: SYSTEM_PROMPT },
      });

      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
          wroteAny = true;
        }
      }

      lastError = null;
      break; // finished cleanly
    } catch (error) {
      lastError = error;
      const msg = error?.message || String(error);
      console.error(`/chat attempt ${attempt}/${MAX_ATTEMPTS} failed:`, msg);
      // A 429 means we've hit the API usage limit — retrying immediately
      // won't help, so stop and report it clearly.
      if (/429|too many requests|resource_exhausted|quota/i.test(msg)) {
        lastError.isRateLimit = true;
        break;
      }
      if (!wroteAny && attempt < MAX_ATTEMPTS) {
        await sleep(500 * attempt); // brief backoff before retrying
      }
    }
  }

  // Only show an error if we never managed to send any text
  if (lastError && !wroteAny) {
    const friendly = lastError.isRateLimit
      ? "RachitAI has hit its free usage limit for the moment. Please wait about a minute and try again."
      : "The AI is busy right now — please try again.";
    res.write(`data: ${JSON.stringify({ error: friendly })}\n\n`);
  }

  res.write("data: [DONE]\n\n");
  res.end();
});

// Hosting platforms tell us which port to use via process.env.PORT.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RachitAI server running on http://localhost:${PORT}`);
});
