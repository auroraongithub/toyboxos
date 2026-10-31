# Models and providers

Set these up in the app: Start > Models and keys (or the assistant's ⋯ menu). Add a provider, paste its key once, then
tick the models you want from the provider's own list and pick which one chats and which one does background work
(compaction, job scoring). Nothing about models is hardcoded.

- `server/providers.json`: the provider types the app can add (address, protocol, where to get a key). No models.
- `server/ai.json`: your providers and models, written by the app. Never committed. You can still edit it by hand.
- `secrets.json` next to `server.py` (mode 600): the keys, written by the app. Nothing reads them back out: the app only
  learns whether a provider has a key. A provider's `key_env` environment variable works too. Old `<provider>_key.txt`
  files are moved into `secrets.json` (and deleted) when the server starts.

A model is named `<provider>:<model>`, e.g. `gemini:gemini-3.5-flash-lite`. A provider with `"bare_ids": true`
(OpenRouter) also takes its own ids unprefixed, e.g. `deepseek/deepseek-v4.1-flash`.

## By hand

A provider in `ai.json` names its `kind` (one of the types in providers.json, or `custom` with a `url`) and lists models:

```json
{"providers": {"grok": {"models": {"grok-4.6": {"label": "Grok 4.6", "price": [0.12, 0.36, 0.03], "context": 200000}}}}}
```

## Add a provider

Any OpenAI-compatible chat completions API works with one entry:

```json
{"providers": {"acme": {
  "label": "Acme AI",
  "url": "https://api.acme.example/v1/chat/completions",
  "key_env": "ACME_API_KEY",
  "cap_usd": 5,
  "models": {"acme-large": {"label": "Acme Large", "price": [0.5, 1.5, 0.05], "context": 128000, "vision": true}}
}}}
```

Then put the key in `server/acme_key.txt` and restart the server. It shows up in the picker as "Acme AI".

For the Anthropic Messages API, add `"protocol": "anthropic"` (translation lives in `ai_messages.py`). A new wire protocol means a new adapter module like that one plus a branch in `ai.request()`, `ai.completion()` and `ai.lines()`.

To drop a shipped provider or model, set it to `null`: `{"providers": {"groq": null}}`.

## Fields

Provider:

| field | meaning |
|---|---|
| `label` | name in the picker |
| `url` | chat endpoint |
| `protocol` | `openai` (default) or `anthropic` |
| `key_env` | environment variable for the key (else `<id>_key.txt`) |
| `nokey` | no key needed (a local Ollama) |
| `free` | free tier: 429s are retried after a pause and the picker says "free tier" |
| `cap_usd` | monthly spend limit for this provider; it's skipped once reached |
| `extra` | added to every request body, e.g. `{"reasoning_effort": "low"}` |
| `headers` | extra HTTP headers |
| `openrouter` | OpenRouter extras: real cost reporting, reasoning setting, provider pinning, its web search tool |
| `bare_ids` | model ids work without the `provider:` prefix |
| `signup` | where to get a key |

Model:

| field | meaning |
|---|---|
| `label` | name in the picker |
| `price` | USD per 1M tokens `[input, output, cached input]`; used to estimate spend when the provider reports no cost |
| `context` | context window in tokens; the app shows a context meter and compacts the chat at 80% |
| `free_day` | free requests a day; the model is skipped once used up |
| `vision` | it reads images |
| `extra` | replaces the provider's `extra` for this model (`{}` sends none) |
| `pin` | OpenRouter provider order, so its prompt cache keeps hitting |
| `cache_hints` | add Anthropic `cache_control` marks |
| `inline_thinking` | the model streams `<thought>` text that should be hidden |
| `hidden` | keep it configured but out of the picker |

Top level:

| field | meaning |
|---|---|
| `default` | the model used when the app asks for none |
| `utility` | the cheap model for background work (chat compaction) |
| `chain` | fallbacks, in order, when the chosen model is busy, used up or at its cap |
| `reasoning`, `max_tokens`, `web_tool` | request defaults |

## Models on your own machine

The app also finds models running on the device itself (llama-server via `server/local-ai/local_ai.py`, Ollama, LM Studio) and lists them under "This PC". Those are probed by the app (`src/core/local-ai.js`), not configured here.

## What the app reads

`GET /api/ai/models` returns the catalogue with live state: whether each provider has a key, this month's spend against its cap, free requests left today, and for each model why it can't run right now (`no key`, `monthly cap reached`, `free limit reached today`). `GET /api/ai/usage` returns the same plus month totals. The picker (`ModelPicker` in `src/modules/buddy.js`, helpers in `src/core/models.js`) renders that as-is.
