# Connect an AI app (MCP)

Every toybox sync server has an MCP endpoint at `<server address>/mcp`. Claude Code, Codex, the Claude desktop app or
any other MCP client can use it to read and edit your notes, board, calendar, reminders, money and jobs. It needs the
same token your devices sync with, so it works wherever sync works (home Wi-Fi, Tailscale, Funnel).

## Setting it up

1. Turn on sync on any device (Start > Sync).
2. In the Sync window, next to **AI apps**, press **Connect…** (or type `mcp` in the command bar).
3. Pick your app, press **Copy**, and paste:
   - **Claude Code**: paste the command into a terminal. `-s user` makes it available in every project.
   - **Codex**: paste the block at the end of `~/.codex/config.toml`.
   - **Claude app**: Settings > Developer > Edit Config, paste inside `"mcpServers": { … }`. Needs Node.js, because
     the desktop app reaches HTTP servers through `mcp-remote`.
   - **Other**: the URL and the header to give your client.
4. Restart the app and ask it something like "what's due this week?".

The copied text contains your sync token. Treat it like a password. Anyone who has it can read and change your data.
To cut every app and device off, change the token on the server (`token.txt`) and pair your devices again.

If the sheet says the server doesn't have it yet, update the server first (Sync > Server > Install now, or redeploy).

### Keeping the token out of config files (optional)

Put the token in an environment variable and point the config at that variable:

```bash
claude mcp add --transport http -s user toybox https://your-server/mcp --header 'Authorization: Bearer ${TOYBOX_TOKEN}'
```

```toml
[mcp_servers.toybox]
url = "https://your-server/mcp"
bearer_token_env_var = "TOYBOX_TOKEN"
```

On Windows: `[Environment]::SetEnvironmentVariable('TOYBOX_TOKEN', '<token>', 'User')`, then restart the terminal.

## What the AI can do

| Tool | |
|---|---|
| `overview` | Today: weekly classes, events and Moodle deadlines for the next 7 days, reminders, open tasks, Inbox jots |
| `search` | Ranked notes snippets plus matches in the other collections |
| `read_page` | A page's body, fields, flashcards, parent, sub-pages, backlinks and connections |
| `write_page` | New page, append or replace, optionally under a subject |
| `list` / `get` | Any collection, newest first, with a text filter |
| `save` | Create, or merge-update, a task, event, reminder, jot, expense, job, link, habit, timetable class… |
| `delete` | Removes a doc on every device. Most clients ask you before running it |

Writes are checked against the same rules the app uses: required fields, allowed values, and read-only data
(Moodle deadlines, flashcard review state, whiteboard ink, Osage's chats). They reach your other devices on their next
sync. Times are in your server's Manila offset (UTC+8).

## Technical

`POST /mcp` in server/server.py, handled by server/mcp.py: MCP over Streamable HTTP with plain JSON replies (no
server-sent stream, no sessions), protocol versions 2025-06-18 / 2025-03-26 / 2024-11-05, auth
`Authorization: Bearer <sync token>`. Write rules (`SPEC`) mirror src/core/workspace.js; keep both in step when a
collection changes. Test: `python -m unittest discover -s server -p test_mcp.py`.
