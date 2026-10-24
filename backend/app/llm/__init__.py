"""LLM adapter interface (spec §13). Stage 2 ports frontend/src/server/ai/direct to Python with the
google-genai SDK; prompts and the flat LaTeX wire formats stay identical (packages/contracts/json)."""

from typing import Protocol


class LlmProvider(Protocol):
    name: str
    mock: bool

    async def generate_json(self, *, task: str, model: str, system: str, parts: list[dict], schema: dict, timeout_s: float) -> dict: ...
