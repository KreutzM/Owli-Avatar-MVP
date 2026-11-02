"""Bounded, process-local conversation storage."""
import asyncio
import secrets
import time
from dataclasses import dataclass, field


@dataclass
class Session:
    messages: list[dict[str, str]] = field(default_factory=list)
    touched: float = field(default_factory=time.monotonic)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class Sessions:
    def __init__(self, limit=100, ttl=1800, max_messages=12, max_chars=12000):
        self.limit, self.ttl, self.max_messages, self.max_chars = limit, ttl, max_messages, max_chars
        self.items: dict[str, Session] = {}

    def get(self, session_id: str | None) -> tuple[str, Session]:
        now = time.monotonic()
        for key, session in list(self.items.items()):
            if not session.lock.locked() and now - session.touched > self.ttl:
                del self.items[key]
        if session_id:
            if session_id not in self.items:
                raise KeyError
            return session_id, self.items[session_id]
        if len(self.items) >= self.limit:
            raise OverflowError
        session_id = secrets.token_urlsafe(24)
        self.items[session_id] = Session(touched=now)
        return session_id, self.items[session_id]

    def add_turn(self, session: Session, message: str, reply: str) -> None:
        session.messages.extend([{"role": "user", "content": message}, {"role": "assistant", "content": reply}])
        while len(session.messages) > self.max_messages or sum(len(m["content"]) for m in session.messages) > self.max_chars:
            del session.messages[:2]
        session.touched = time.monotonic()
