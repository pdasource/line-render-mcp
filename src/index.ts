import crypto from "node:crypto";
import express, { type Request, type Response } from "express";
import { LineBotClient } from "@line/bot-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(\`${name} must be set\`);
  return value;
};

const channelAccessToken = required("CHANNEL_ACCESS_TOKEN");
const channelSecret = required("LINE_CHANNEL_SECRET");
const mcpApiKey = required("MCP_API_KEY");
const defaultDestination = process.env.DESTINATION_ID;
const lineClient = LineBotClient.fromChannelAccessToken({ channelAccessToken });
const knownGroups = new Map<string, { name?: string; lastSeenAt: string }>();

const isAuthorized = (request: Request): boolean => {
  const auth = request.header("authorization");
  const expected = \`Bearer ${mcpApiKey}\`;
  if (!auth || auth.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
};

const sendText = async (to: string, text: string) => {
  await lineClient.pushMessage({ to, messages: [{ type: "text", text }] });
  return { content: [{ type: "text" as const, text: \`ส่งข้อความ LINE ไปยัง ${to} เรียบร้อยแล้ว\` }] };
};

const server = new McpServer({ name: "LINE Messaging", version: "1.0.0" });

server.tool(
  "send_text_message",
  "ส่งข้อความแบบ Text ไปยัง LINE User ID (U...) หรือ Group ID (C...).",
  { to: z.string().min(1), text: z.string().min(1).max(5000) },
  async ({ to, text }) => sendText(to, text),
);

server.tool(
  "send_to_default_recipient",
  "ส่งข้อความแบบ Text ไปยังผู้รับเริ่มต้นที่ตั้งค่าไว้ใน DESTINATION_ID.",
  { text: z.string().min(1).max(5000) },
  async ({ text }) => {
    if (!defaultDestination) {
      return { content: [{ type: "text" as const, text: "ยังไม่ได้ตั้งค่า DESTINATION_ID" }], isError: true };
    }
    return sendText(defaultDestination, text);
  },
);

server.tool(
  "send_flex_message",
  "ส่ง Flex Message ไปยัง LINE User ID (U...) หรือ Group ID (C...). contents ต้องเป็น Flex container ที่ถูกต้องตาม LINE Messaging API.",
  {
    to: z.string().min(1),
    altText: z.string().min(1).max(400),
    contents: z.unknown(),
  },
  async ({ to, altText, contents }) => {
    await lineClient.pushMessage({
      to,
      messages: [{ type: "flex", altText, contents: contents as never }],
    });
    return { content: [{ type: "text" as const, text: \`ส่ง Flex Message ไปยัง ${to} เรียบร้อยแล้ว\` }] };
  },
);

server.tool(
  "get_known_groups",
  "แสดง Group ID ที่ LINE OA เคยได้รับ webhook ตั้งแต่บริการเริ่มรันล่าสุด.",
  {},
  async () => ({
    content: [{
      type: "text" as const,
      text: JSON.stringify([...knownGroups].map(([groupId, details]) => ({ groupId, ...details })), null, 2),
    }],
  }),
);

server.tool(
  "get_message_quota",
  "ดูโควต้าข้อความ LINE Official Account ประจำเดือน.",
  {},
  async () => {
    const quota = await lineClient.getMessageQuota();
    const consumption = await lineClient.getMessageQuotaConsumption();
    return { content: [{ type: "text" as const, text: JSON.stringify({ quota, consumption }, null, 2) }] };
  },
);

const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
await server.connect(transport);

const app = express();
app.use(express.json({
  limit: "2mb",
  verify: (request, _response, buffer) => {
    (request as Request & { rawBody?: Buffer }).rawBody = buffer;
  },
}));

app.get("/health", (_request, response) => response.json({ ok: true }));

app.post("/callback", async (request, response) => {
  const rawBody = (request as Request & { rawBody?: Buffer }).rawBody;
  const signature = request.header("x-line-signature") ?? "";
  const expected = crypto.createHmac("SHA256", channelSecret).update(rawBody ?? "").digest("base64");

  if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return response.status(401).json({ error: "Invalid LINE signature" });
  }

  const events = Array.isArray(request.body?.events) ? request.body.events : [];
  for (const event of events) {
    if (event?.source?.type === "group" && event.source.groupId) {
      knownGroups.set(event.source.groupId, { lastSeenAt: new Date().toISOString() });
      console.info("LINE group webhook received", { groupId: event.source.groupId, eventType: event.type });
    }
  }
  return response.status(200).json({ ok: true });
});

app.all("/mcp", async (request, response) => {
  if (!isAuthorized(request)) {
    return response.status(401).json({ error: "Unauthorized" });
  }
  await transport.handleRequest(request, response, request.body);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "0.0.0.0", () => console.info(\`LINE MCP listening on :${port}\`));
