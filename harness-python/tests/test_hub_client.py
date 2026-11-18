import asyncio
import json
import socket
import sys
import unittest
from pathlib import Path

from aiohttp import web

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from claude_agent_sdk import AssistantMessage, TextBlock, ToolUseBlock  # noqa: E402

from harness import hub_client  # noqa: E402
from harness.hub_client import HubClient, HubUnavailable, TurnTracker, summarize  # noqa: E402
from harness.orchestrator import check_stage  # noqa: E402


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class FakeHub:
    """Takes events, and serves one inbox input per connection, so each input needs a reconnect."""

    def __init__(self, port: int):
        self.port = port
        self.events: list[dict] = []
        self.inputs: asyncio.Queue = asyncio.Queue()
        self.inbox_connections = 0
        self.runner = None

    async def start(self) -> None:
        app = web.Application()
        app.router.add_post("/api/runs", self.register)
        app.router.add_post("/api/runs/{id}/events", self.receive)
        app.router.add_get("/api/runs/{id}/inbox", self.inbox)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        await web.TCPSite(self.runner, "127.0.0.1", self.port).start()

    async def stop(self) -> None:
        await self.runner.cleanup()

    async def register(self, request):
        return web.json_response({"id": "r1"}, status=201)

    async def receive(self, request):
        self.events.extend((await request.json())["events"])
        return web.json_response({"accepted": True})

    async def inbox(self, request):
        self.inbox_connections += 1
        response = web.StreamResponse(headers={"content-type": "text/event-stream"})
        await response.prepare(request)
        item = await self.inputs.get()
        line = "{not json" if item == "not json" else json.dumps(item)
        await response.write(f"data: {line}\n\n".encode())
        return response


class HubClientTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.saved_retry = hub_client.RETRY_SECONDS
        hub_client.RETRY_SECONDS = 0.05
        self.port = free_port()
        self.url = f"http://127.0.0.1:{self.port}"

    async def asyncTearDown(self):
        hub_client.RETRY_SECONDS = self.saved_retry

    async def test_register_fails_when_hub_is_down(self):
        with self.assertRaises(HubUnavailable):
            await HubClient.register(self.url, {"story": "s", "stages": []})

    async def test_keeps_events_while_hub_is_down(self):
        client = HubClient(self.url, "r1")
        client.emit({"type": "message", "stage": "plan", "role": "assistant", "text": "one"})
        await asyncio.sleep(0.1)
        hub = FakeHub(self.port)
        await hub.start()
        try:
            await client.close()
            self.assertEqual([e["text"] for e in hub.events], ["one"])
        finally:
            await hub.stop()

    async def test_answer_arrives_after_inbox_reconnects(self):
        hub = FakeHub(self.port)
        await hub.start()
        try:
            client = await HubClient.register(self.url, {"story": "s", "stages": ["plan"]})
            messages: list[str] = []
            client.on_message = messages.append
            client.start_inbox()
            asked = asyncio.create_task(client.ask("question", {"questions": []}, "plan"))
            await hub.inputs.put({"type": "message", "text": "hello"})
            await hub.inputs.put({"type": "answer", "requestId": "q1", "response": {"answers": {"a": "b"}}})
            self.assertEqual(await asyncio.wait_for(asked, 2), {"answers": {"a": "b"}})
            self.assertEqual(messages, ["hello"])
            self.assertGreaterEqual(hub.inbox_connections, 2)
            await client.close()
            self.assertEqual(hub.events[0]["type"], "pending")
        finally:
            await hub.stop()

    async def test_long_and_bad_inbox_lines_do_not_stop_the_inbox(self):
        hub = FakeHub(self.port)
        await hub.start()
        try:
            client = await HubClient.register(self.url, {"story": "s", "stages": ["plan"]})
            messages: list[str] = []
            client.on_message = messages.append
            client.start_inbox()
            asked = asyncio.create_task(client.ask("reply", {}, "plan"))
            long_text = "x" * 200_000  # past aiohttp's default 64 KiB line limit
            await hub.inputs.put({"type": "message", "text": long_text})
            await hub.inputs.put("not json")  # FakeHub sends this as a line that is not valid JSON
            await hub.inputs.put({"type": "answer", "requestId": "q1", "response": {"action": "retry"}})
            self.assertEqual(await asyncio.wait_for(asked, 3), {"action": "retry"})
            self.assertEqual(messages, [long_text])
            await client.close()
        finally:
            await hub.stop()

    async def test_unknown_answer_is_ignored(self):
        client = HubClient(self.url, "r1")
        asked = asyncio.create_task(client.ask("permission", {}, "plan"))
        await asyncio.sleep(0)
        client.handle_input({"type": "answer", "requestId": "q99", "response": {"allow": False}})
        client.handle_input({"type": "answer", "requestId": "q1", "response": {"allow": True}})
        self.assertEqual(await asked, {"allow": True})
        client._buffer.clear()
        await client.close()

    async def test_cancelled_request_is_withdrawn(self):
        client = HubClient(self.url, "r1")
        asked = asyncio.create_task(client.ask("question", {}, "plan"))
        await asyncio.sleep(0)
        asked.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await asked
        self.assertEqual([e["type"] for e in client._buffer], ["pending", "resolved"])
        client._buffer.clear()
        await client.close()


class TurnTrackerTests(unittest.TestCase):
    class Result:
        def __init__(self, uuids=None, last=None):
            self.user_message_uuids = uuids
            self.user_message_uuid = last

    def test_waits_for_a_message_sent_mid_turn(self):
        turns = TurnTracker()
        turns.sent("a")
        turns.sent("b")
        self.assertFalse(turns.consume(self.Result(["a"], "a")))
        self.assertTrue(turns.consume(self.Result(["b"], "b")))

    def test_folded_messages_are_answered_together(self):
        turns = TurnTracker()
        turns.sent("a")
        turns.sent("b")
        self.assertTrue(turns.consume(self.Result(["a", "b"], "b")))

    def test_without_uuids_each_result_answers_the_oldest(self):
        turns = TurnTracker()
        turns.sent("a")
        turns.sent("b")
        self.assertFalse(turns.consume(self.Result()))
        self.assertTrue(turns.consume(self.Result()))


class CheckStageTests(unittest.TestCase):
    def test_stage_without_schema_passes_with_an_output_key(self):
        check = check_stage({"name": "docs"}, {"subtype": "success", "output": None}, Path("."))
        self.assertTrue(check["passed"])
        self.assertIn("output", check)


class SummarizeTests(unittest.TestCase):
    def test_assistant_text_and_tool_call(self):
        message = AssistantMessage(
            content=[TextBlock(text="Planning."), ToolUseBlock(id="t1", name="Read", input={"file_path": "a"})],
            model="m",
        )
        events = summarize(message, "plan")
        self.assertEqual([e["role"] for e in events], ["assistant", "tool"])
        self.assertEqual(events[1]["text"], 'Read {"file_path": "a"}')


if __name__ == "__main__":
    unittest.main()
