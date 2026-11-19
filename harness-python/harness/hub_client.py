"""The orchestrator's side of the dashboard hub (harness-ts/src/hub.ts).

It sends the same JSON as harness-ts/src/hubClient.ts; harness-ts/src/hubTypes.ts has the shapes.
`emit` buffers events and sends them in batches. If the hub is down, the buffer keeps them
and the client retries every 2 seconds. `ask` sends a pending request and waits for the
person's answer, which arrives on the inbox stream.
"""
import asyncio
import json
import sys
import time
from typing import Any, Callable, Optional

import aiohttp
from claude_agent_sdk import AssistantMessage, ResultMessage, SystemMessage, TextBlock, ToolResultBlock, ToolUseBlock, UserMessage

RETRY_SECONDS = 2.0
MAX_TEXT = 2000
# The hub accepts bodies up to 1 MB, and one inbox line holds one of them. aiohttp's default
# line limit is 64 KiB, which a long pasted answer goes past.
READ_BUFSIZE = 4 * 1024 * 1024


class HubUnavailable(Exception):
    pass


class HubClient:
    def __init__(self, url: str, run_id: str, session: Optional[aiohttp.ClientSession] = None):
        self.url = url
        self.run_id = run_id
        self.on_message: Callable[[str], None] = lambda text: None
        self.on_interrupt: Callable[[], None] = lambda: None
        self._session = session or aiohttp.ClientSession(read_bufsize=READ_BUFSIZE)
        self._buffer: list[dict] = []
        self._waiters: dict[str, asyncio.Future] = {}
        self._counter = 0
        self._closed = False
        self._wake = asyncio.Event()
        self._flusher = asyncio.create_task(self._flush_loop())
        self._inbox: Optional[asyncio.Task] = None

    @classmethod
    async def register(cls, url: str, info: dict) -> "HubClient":
        """Register a run. Raises HubUnavailable if the hub cannot be reached."""
        session = aiohttp.ClientSession(read_bufsize=READ_BUFSIZE)
        try:
            async with session.post(f"{url}/api/runs", json=info) as res:
                if res.status != 201:
                    text = await res.text()
                    await session.close()
                    raise HubUnavailable(f"The hub refused the run: {res.status} {text}")
                run_id = (await res.json())["id"]
        except aiohttp.ClientError as error:
            await session.close()
            raise HubUnavailable(
                f'Cannot reach the dashboard hub at {url}. Start it with "npm run hub" in harness-ts. ({error})'
            ) from error
        return cls(url, run_id, session)

    def emit(self, event: dict) -> None:
        self._buffer.append(event)
        self._wake.set()

    async def ask(self, kind: str, payload: dict, stage: Optional[str] = None) -> Any:
        """Send a request to the page and wait for the answer. Cancelling the wait withdraws it."""
        self._counter += 1
        request_id = f"q{self._counter}"
        future = asyncio.get_running_loop().create_future()
        self._waiters[request_id] = future
        self.emit({"type": "pending", "request": {"id": request_id, "kind": kind, "stage": stage, "payload": payload}})
        try:
            return await future
        except asyncio.CancelledError:
            if self._waiters.pop(request_id, None) is not None:
                self.emit({"type": "resolved", "requestId": request_id})
            raise

    def handle_input(self, data: dict) -> None:
        """Route one input from the inbox. Public so tests can call it."""
        if data.get("type") == "answer":
            future = self._waiters.pop(str(data.get("requestId")), None)
            if future is not None and not future.done():
                future.set_result(data.get("response"))
        elif data.get("type") == "message":
            self.on_message(str(data.get("text", "")))
        elif data.get("type") == "interrupt":
            self.on_interrupt()

    def start_inbox(self) -> None:
        self._inbox = asyncio.create_task(self._inbox_loop())

    async def close(self) -> None:
        """Stop the inbox and send what is left in the buffer, waiting at most 5 seconds."""
        self._closed = True
        if self._inbox:
            self._inbox.cancel()
        deadline = time.monotonic() + 5
        while self._buffer and time.monotonic() < deadline:
            self._wake.set()
            await asyncio.sleep(0.1)
        self._flusher.cancel()
        await self._session.close()

    async def _flush_loop(self) -> None:
        while True:
            await self._wake.wait()
            self._wake.clear()
            while self._buffer:
                batch = list(self._buffer)
                try:
                    async with self._session.post(
                        f"{self.url}/api/runs/{self.run_id}/events", json={"events": batch}
                    ) as res:
                        if res.status != 200:
                            raise aiohttp.ClientError(f"events returned {res.status}")
                    del self._buffer[: len(batch)]
                except (aiohttp.ClientError, OSError):
                    # The hub is down or restarting. Keep the batch and try again.
                    await asyncio.sleep(RETRY_SECONDS)

    async def _inbox_loop(self) -> None:
        while not self._closed:
            try:
                async with self._session.get(
                    f"{self.url}/api/runs/{self.run_id}/inbox", timeout=aiohttp.ClientTimeout(total=None)
                ) as res:
                    if res.status != 200:
                        raise aiohttp.ClientError(f"inbox returned {res.status}")
                    async for raw in res.content:
                        line = raw.decode("utf-8").strip()
                        if not line.startswith("data: "):
                            continue
                        # One bad line must not drop the stream or the inputs after it.
                        try:
                            self.handle_input(json.loads(line[6:]))
                        except ValueError as error:
                            print(f"Skipped an inbox line that is not valid JSON: {error}", file=sys.stderr)
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001
                # Any failure, not only network errors, must end in a reconnect. If this task
                # ended, no answer would arrive and the run would wait forever.
                if not self._closed:
                    print(f"The hub inbox dropped ({error!r}). Reconnecting.", file=sys.stderr)
            if not self._closed:
                await asyncio.sleep(RETRY_SECONDS)


class TurnTracker:
    """Tracks which user messages still wait for an answer. A message sent mid-turn runs as
    its own turn later, or folds into the current one, so a result is the end of the exchange
    only when no sent message is left. Results name the messages they consumed in
    user_message_uuids. Older CLIs leave that out, and then each result consumes the oldest."""

    def __init__(self) -> None:
        self._outstanding: list[str] = []

    def sent(self, uuid: str) -> None:
        self._outstanding.append(uuid)

    def consume(self, result: Any) -> bool:
        """Record one result. Returns True when no sent message is left without an answer."""
        consumed = getattr(result, "user_message_uuids", None)
        if not consumed and getattr(result, "user_message_uuid", None):
            consumed = [result.user_message_uuid]
        if consumed:
            for uuid in consumed:
                if uuid in self._outstanding:
                    self._outstanding.remove(uuid)
        elif self._outstanding:
            self._outstanding.pop(0)
        return not self._outstanding


def _clip(text: str, limit: int = MAX_TEXT) -> str:
    return f"{text[:limit]}… ({len(text) - limit} more characters)" if len(text) > limit else text


def summarize(message: Any, stage: str) -> list[dict]:
    """Turn one SDK message into short transcript events for the page."""
    events: list[dict] = []

    def add(role: str, text: str) -> None:
        events.append({"type": "message", "stage": stage, "role": role, "text": _clip(text)})

    if isinstance(message, AssistantMessage):
        for block in message.content:
            if isinstance(block, TextBlock) and block.text.strip():
                add("assistant", block.text)
            elif isinstance(block, ToolUseBlock):
                add("tool", f"{block.name} {json.dumps(block.input)}")
    elif isinstance(message, UserMessage) and isinstance(message.content, list):
        for block in message.content:
            if not isinstance(block, ToolResultBlock):
                continue
            if isinstance(block.content, str):
                content = block.content
            else:
                content = "\n".join(
                    part.get("text", "") if part.get("type") == "text" else f"[{part.get('type')}]"
                    for part in (block.content or [])
                )
            add("tool", f"{'error' if block.is_error else 'result'}: {_clip(content, 500)}")
    elif isinstance(message, ResultMessage):
        add("result", f"{message.subtype}, {message.num_turns} turns, ${message.total_cost_usd or 0:.4f}")
    elif isinstance(message, SystemMessage) and message.subtype == "init":
        plugins = ", ".join(p.get("name", "?") for p in message.data.get("plugins", [])) or "none"
        add("system", f"Session started. Model {message.data.get('model')}. Plugins: {plugins}.")
    return events
