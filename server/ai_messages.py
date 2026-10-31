"""Translate the app's OpenAI chat format to/from the Anthropic Messages API."""

import json
import re


def _content(content):
    if isinstance(content, str):
        return [{"type": "text", "text": content}] if content else []
    blocks = []
    for part in content or []:
        if part.get("type") == "text":
            if part.get("text"):
                blocks.append({"type": "text", "text": part["text"]})
        elif part.get("type") == "image_url":
            image = part["image_url"]
            url = image if isinstance(image, str) else image["url"]
            data = re.fullmatch(r"data:(image/[\w.+-]+);base64,(.+)", url, re.DOTALL)
            source = {"type": "base64", "media_type": data[1], "data": data[2]} if data else {"type": "url", "url": url}
            blocks.append({"type": "image", "source": source})
        else:
            raise ValueError("Unsupported Messages API content: " + str(part.get("type")))
    return blocks


def request(body):
    system, messages = [], []
    for message in body["messages"]:
        role = message["role"]
        if role == "system":
            system.extend(_content(message.get("content")))
            continue
        if role == "tool":
            blocks = [
                {
                    "type": "tool_result",
                    "tool_use_id": message["tool_call_id"],
                    "content": _content(message.get("content")),
                }
            ]
            role = "user"
        elif role in ("user", "assistant"):
            blocks = _content(message.get("content"))
            for call in message.get("tool_calls") or []:
                function = call["function"]
                arguments = json.loads(function.get("arguments") or "{}")
                if not isinstance(arguments, dict):
                    raise ValueError("Tool arguments must be an object")
                blocks.append({"type": "tool_use", "id": call["id"], "name": function["name"], "input": arguments})
        else:
            raise ValueError("Unsupported Messages API role: " + str(role))
        if not blocks:
            continue
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"].extend(blocks)
        else:
            messages.append({"role": role, "content": blocks})
    if (body.get("response_format") or {}).get("type") == "json_object":
        system.append({"type": "text", "text": "Respond with a valid JSON object only."})
    # Stable system prefix + the latest user/tool result; at most two cache breakpoints.
    if system:
        system[-1]["cache_control"] = {"type": "ephemeral"}
    for message in reversed(messages):
        if message["role"] == "user":
            message["content"][-1]["cache_control"] = {"type": "ephemeral"}
            break
    out = {
        "model": body["model"],
        "messages": messages,
        "max_tokens": body["max_tokens"],
        "stream": body.get("stream", False),
    }
    if system:
        out["system"] = system
    if body.get("tools"):
        out["tools"] = [
            {
                "name": tool["function"]["name"],
                "description": tool["function"].get("description", ""),
                "input_schema": tool["function"].get("parameters") or {"type": "object", "properties": {}},
            }
            for tool in body["tools"]
        ]
    choice = body.get("tool_choice")
    if isinstance(choice, dict):
        out["tool_choice"] = {"type": "tool", "name": choice["function"]["name"]}
    elif choice:
        out["tool_choice"] = {"type": "any" if choice == "required" else choice}
    for name in ("temperature", "top_p", "top_k", "stop_sequences", "metadata"):
        if name in body:
            out[name] = body[name]
    return out


def usage(value):
    cached = int(value.get("cache_read_input_tokens") or 0)
    created = int(value.get("cache_creation_input_tokens") or 0)
    one_hour = int((value.get("cache_creation") or {}).get("ephemeral_1h_input_tokens") or 0)
    return {
        "prompt_tokens": int(value.get("input_tokens") or 0) + cached + created,
        "completion_tokens": int(value.get("output_tokens") or 0),
        "prompt_tokens_details": {
            "cached_tokens": cached,
            "cache_creation_tokens": created,
            "cache_creation_1h_tokens": one_hour,
        },
        **({"cost": value["cost"]} if value.get("cost") is not None else {}),
    }


def _finish(reason):
    return {"tool_use": "tool_calls", "max_tokens": "length"}.get(reason, "stop")


def completion(value):
    text, calls = [], []
    for block in value.get("content") or []:
        if block["type"] == "text":
            text.append(block["text"])
        elif block["type"] == "tool_use":
            calls.append(
                {
                    "id": block["id"],
                    "type": "function",
                    "function": {"name": block["name"], "arguments": json.dumps(block["input"])},
                }
            )
    message = {"role": "assistant", "content": "".join(text)}
    if calls:
        message["tool_calls"] = calls
    return {
        "choices": [{"message": message, "finish_reason": _finish(value.get("stop_reason"))}],
        "usage": usage(value.get("usage") or {}),
    }


def _events(response):
    data = []
    for line in response:
        line = line.rstrip(b"\r\n")
        if line.startswith(b"data:"):
            data.append(line[5:].lstrip(b" "))
        elif not line and data:
            yield json.loads(b"\n".join(data))
            data = []
    if data:
        yield json.loads(b"\n".join(data))


def stream(response):
    """Yield OpenAI-style SSE, retaining partial usage if a stream fails or closes."""
    tokens, tools = {}, {}
    reason = None

    def chunk(delta, finish=None):
        return (
            b"data: "
            + json.dumps({"choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}).encode()
            + b"\n\n"
        )

    def meter():
        return b"data: " + json.dumps({"choices": [], "usage": usage(tokens)}).encode() + b"\n\n"

    for event in _events(response):
        kind = event.get("type")
        if kind == "message_start":
            tokens.update(event["message"].get("usage") or {})
            yield meter()
        elif kind == "content_block_start":
            block = event["content_block"]
            if block["type"] == "text" and block.get("text"):
                yield chunk({"content": block["text"]})
            elif block["type"] == "tool_use":
                arguments = json.dumps(block["input"]) if block.get("input") else ""
                index = len(tools)
                tools[event["index"]] = {"index": index, "arguments": bool(arguments)}
                yield chunk(
                    {
                        "tool_calls": [
                            {
                                "index": index,
                                "id": block["id"],
                                "type": "function",
                                "function": {"name": block["name"], "arguments": arguments},
                            }
                        ]
                    }
                )
        elif kind == "content_block_delta":
            delta = event["delta"]
            if delta["type"] == "text_delta":
                yield chunk({"content": delta["text"]})
            elif delta["type"] == "input_json_delta":
                tool = tools[event["index"]]
                part = delta["partial_json"]
                tool["arguments"] |= bool(part)
                yield chunk({"tool_calls": [{"index": tool["index"], "function": {"arguments": part}}]})
        elif kind == "content_block_stop" and event["index"] in tools:
            tool = tools[event["index"]]
            if not tool["arguments"]:
                yield chunk({"tool_calls": [{"index": tool["index"], "function": {"arguments": "{}"}}]})
        elif kind == "message_delta":
            tokens.update(event.get("usage") or {})
            reason = _finish((event.get("delta") or {}).get("stop_reason"))
            yield meter()
        elif kind == "error":
            yield (
                b"data: "
                + json.dumps({"error": event.get("error") or {"message": "The stream failed."}}).encode()
                + b"\n\n"
            )
            return
        elif kind == "message_stop":
            yield chunk({}, reason or "stop")
            yield b"data: [DONE]\n\n"
            return
    # Never pass off a dropped connection as a successful empty/partial reply.
    yield b'data: {"error":{"message":"The stream ended before message_stop. Please retry."}}\n\n'
