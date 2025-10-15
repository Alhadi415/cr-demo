import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from "@fastify/formbody";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const PORT = Number(process.env.PORT) || 10000;
const HOST = "0.0.0.0";
const DOMAIN = process.env.NGROK_URL || "example.ngrok-free.app";
const WS_URL = `wss://${DOMAIN}/ws`;
const WELCOME_GREETING =
  "Hi! I am a voice assistant powered by Twilio and OpenAI. Ask me anything!";
const SYSTEM_PROMPT =
  "You are a helpful assistant. This conversation is being translated to voice, so answer carefully. When you respond, please spell out all numbers, for example twenty not 20. Do not include emojis, bullet points, or symbols.";

const sessions = new Map();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function aiResponse(messages) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });
  return completion.choices[0].message.content;
}

const fastify = Fastify();
fastify.register(fastifyWs);
fastify.register(fastifyFormBody);

// Twilio XML route
fastify.all("/twiml", async (request, reply) => {
  reply.type("text/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <ConversationRelay url="${WS_URL}" welcomeGreeting="${WELCOME_GREETING}" />
      </Connect>
    </Response>`
  );
});

// WebSocket endpoint
fastify.register(async function (fastify) {
  fastify.get("/ws", { websocket: true }, (ws, req) => {
    ws.on("message", async (data) => {
      const message = JSON.parse(data);

      switch (message.type) {
        case "setup":
          ws.callSid = message.callSid;
          console.log("Setup for call:", ws.callSid);
          sessions.set(ws.callSid, [{ role: "system", content: SYSTEM_PROMPT }]);
          break;

        case "prompt":
          console.log("Prompt:", message.voicePrompt);
          const convo = sessions.get(ws.callSid);
          convo.push({ role: "user", content: message.voicePrompt });

          const replyText = await aiResponse(convo);
          convo.push({ role: "assistant", content: replyText });

          ws.send(JSON.stringify({ type: "text", token: replyText, last: true }));
          console.log("Sent:", replyText);
          break;

        case "interrupt":
          console.log("Interruption detected.");
          break;

        default:
          console.warn("Unknown message type:", message.type);
          break;
      }
    });

    ws.on("close", () => {
      console.log("WebSocket closed:", ws.callSid);
      sessions.delete(ws.callSid);
    });
  });
});

// Start server
fastify.listen({ port: PORT, host: HOST })
  .then(() => {
    console.log(`✅ Server running at http://${HOST}:${PORT} and wss://${DOMAIN}/ws`);
  })
  .catch((err) => {
    console.error("❌ Error starting server:", err);
    process.exit(1);
  });
