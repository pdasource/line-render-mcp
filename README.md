# LINE Webhook + Remote MCP for Render

This service has two public endpoints:

- `POST /callback` — LINE Messaging API webhook, protected by `LINE_CHANNEL_SECRET`.
- `GET, POST, DELETE /mcp` — Streamable HTTP MCP endpoint, protected by `MCP_API_KEY` as a bearer token.

## What it can do

- Send LINE text messages to a User ID (`U...`) or Group ID (`C...`).
- Send LINE Flex Messages.
- Report message quota.
- Receive a group webhook and expose Group IDs received since the service started.

## Deploy to Render

1. Push this directory to a **private** GitHub repository. Do not commit `.env`.
2. In Render, select **New > Blueprint**, choose the repository, and create the service from `render.yaml`.
3. In the Render service's Environment tab, set:
   - `CHANNEL_ACCESS_TOKEN`
   - `LINE_CHANNEL_SECRET`
   - `DESTINATION_ID` (optional)
   - keep the generated `MCP_API_KEY` private.
4. After the deploy succeeds, copy the public URL. It will look like `https://line-render-mcp.onrender.com`.
5. In LINE Developers Console > Messaging API:
   - set Webhook URL to `https://line-render-mcp.onrender.com/callback`;
   - click **Verify**;
   - turn on **Use webhook**;
   - enable **Allow bot to join group chats** if you need group delivery.
6. In a ChatGPT Business workspace, create a custom app with the endpoint:
   `https://line-render-mcp.onrender.com/mcp`
   Configure it to send `Authorization: Bearer <MCP_API_KEY>` and only enable the tools you want.

## Local test

```powershell
npm install
Copy-Item .env.example .env
# Fill the values in .env, then:
npm run dev
```

For a webhook test, use a public HTTPS tunnel only during development. Use the Render URL in production.

## Security notes

- Never put the LINE access token or `MCP_API_KEY` into source code, an issue, or a public repository.
- Keep the Render repository private.
- `MCP_API_KEY` grants the ability to send LINE messages. Rotate it immediately if exposed.
- `get_known_groups` currently stores IDs in process memory only. Use a database before relying on it across redeploys or multiple service instances.
