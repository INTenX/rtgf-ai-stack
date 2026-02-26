#!/usr/bin/env python3
"""
Gemini MyActivity.json → LibreChat MongoDB importer

Reads a Google Takeout Gemini export (MyActivity.json) and inserts
conversations + messages into LibreChat's MongoDB via Docker exec.

Usage:
  python3 gemini-librechat-import.py [--dry-run] [--export PATH] [--batch-size N]
"""

import argparse
import json
import os
import sys
import uuid
from html.parser import HTMLParser

# ─── Defaults ────────────────────────────────────────────────────────────────
DEFAULT_EXPORT = "/mnt/c/Users/nsagf/Downloads/GeminiExport/g3-mb-tester-7083f8583860762b/MyActivity.json"
DOCKER_SOCKET  = "/mnt/wsl/docker-desktop-bind-mounts/Ubuntu-AI-Hub/docker.sock"
CONTAINER      = "chat-mongodb"
DB             = "LibreChat"
USER_ID        = "6993538dbc89a68b484e286b"
ENDPOINT       = "google"
MODEL          = "gemini-pro"
SENDER         = "Gemini"
IMPORT_TAG     = "gemini-import"
NULL_UUID      = "00000000-0000-0000-0000-000000000000"
BATCH_SIZE     = 50


# ─── HTML → plain text ───────────────────────────────────────────────────────
class _HTMLToText(HTMLParser):
    BLOCK_TAGS = {"p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "br", "div", "tr"}
    CODE_TAGS  = {"code", "pre"}

    def __init__(self):
        super().__init__()
        self._buf   = []
        self._out   = []
        self._in_code = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.CODE_TAGS:
            self._in_code += 1

    def handle_endtag(self, tag):
        if tag in self.CODE_TAGS:
            self._in_code = max(0, self._in_code - 1)
        if tag in self.BLOCK_TAGS:
            chunk = "".join(self._buf).strip()
            if chunk:
                self._out.append(chunk)
            self._buf = []

    def handle_data(self, data):
        self._buf.append(data)

    def get_text(self):
        leftover = "".join(self._buf).strip()
        if leftover:
            self._out.append(leftover)
        return "\n\n".join(self._out)


def html_to_text(html: str) -> str:
    p = _HTMLToText()
    try:
        p.feed(html)
        return p.get_text()
    except Exception:
        # Fallback: strip all tags
        import re
        return re.sub(r"<[^>]+>", " ", html).strip()


def strip_prompted(title: str) -> str:
    if title.lower().startswith("prompted "):
        return title[9:]
    return title


# ─── Docker API helpers ───────────────────────────────────────────────────────
import io
import subprocess
import tarfile
import tempfile


def _docker_post(sock_path: str, path: str, body: bytes,
                 content_type: str = "application/json",
                 timeout: int = 30) -> str:
    """POST to Docker API via curl with body in a temp file."""
    with tempfile.NamedTemporaryFile(delete=False) as tf:
        tf.write(body)
        tf_path = tf.name
    try:
        r = subprocess.run(
            ["curl", "-s", "--unix-socket", sock_path,
             "-X", "POST", f"http://localhost{path}",
             "-H", f"Content-Type: {content_type}",
             "-d", f"@{tf_path}"],
            capture_output=True, text=True, timeout=timeout,
        )
        return r.stdout
    finally:
        os.unlink(tf_path)


def docker_copy_file(sock_path: str, container: str,
                     content: bytes, dest_path: str) -> None:
    """Copy a file into a container via Docker archive API."""
    filename = os.path.basename(dest_path)
    dest_dir  = os.path.dirname(dest_path)

    # Build in-memory tar archive
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        info = tarfile.TarInfo(name=filename)
        info.size = len(content)
        tar.addfile(info, io.BytesIO(content))
    tar_bytes = buf.getvalue()

    with tempfile.NamedTemporaryFile(delete=False, suffix=".tar") as tf:
        tf.write(tar_bytes)
        tf_path = tf.name
    try:
        subprocess.run(
            ["curl", "-s", "--unix-socket", sock_path,
             "-X", "PUT",
             f"http://localhost/containers/{container}/archive?path={dest_dir}",
             "-H", "Content-Type: application/x-tar",
             "--data-binary", f"@{tf_path}"],
            capture_output=True, timeout=30,
        )
    finally:
        os.unlink(tf_path)


def docker_exec(sock_path: str, container: str, cmd: list,
                timeout: int = 60) -> str:
    """Run a command in a container and return stdout."""
    create_payload = json.dumps({
        "Cmd": cmd,
        "AttachStdout": True,
        "AttachStderr": True,
    }).encode()

    create_out = _docker_post(sock_path,
                              f"/containers/{container}/exec",
                              create_payload)
    exec_id = json.loads(create_out)["Id"]

    start_payload = b'{"Detach": false, "Tty": false}'
    with tempfile.NamedTemporaryFile(delete=False) as tf:
        tf.write(start_payload)
        tf_path = tf.name
    try:
        r = subprocess.run(
            ["curl", "-s", "--unix-socket", sock_path,
             "-X", "POST", f"http://localhost/exec/{exec_id}/start",
             "-H", "Content-Type: application/json",
             "-d", f"@{tf_path}"],
            capture_output=True, timeout=timeout,
        )
    finally:
        os.unlink(tf_path)

    return _demux_docker_stream(r.stdout)


def docker_exec_js(sock_path: str, container: str, js: str,
                   timeout: int = 60) -> str:
    """Copy JS to container and run with mongosh --file (avoids ARG_MAX)."""
    remote_path = "/tmp/_import_batch.js"
    docker_copy_file(sock_path, container, js.encode(), remote_path)
    return docker_exec(sock_path, container,
                       ["mongosh", "--quiet", "--file", remote_path],
                       timeout=timeout)


def _demux_docker_stream(data: bytes) -> str:
    """Parse Docker multiplexed stream format."""
    out = []
    i = 0
    while i < len(data):
        if i + 8 > len(data):
            # Not a valid frame — treat remainder as raw text
            out.append(data[i:].decode(errors="replace"))
            break
        size = int.from_bytes(data[i + 4:i + 8], "big")
        payload = data[i + 8:i + 8 + size]
        out.append(payload.decode(errors="replace"))
        i += 8 + size
    return "".join(out)


# ─── Data conversion ──────────────────────────────────────────────────────────
def convert_entries(entries: list) -> tuple[list, list]:
    """Convert Gemini export entries to (conversations, messages) lists."""
    conversations = []
    messages      = []

    for entry in entries:
        if entry.get("header") != "Gemini Apps":
            continue

        conv_id     = str(uuid.uuid4())
        user_msg_id = str(uuid.uuid4())
        asst_msg_id = str(uuid.uuid4())

        raw_title   = entry.get("title", "Untitled")
        user_prompt = strip_prompted(raw_title)[:2000]
        ts          = entry.get("time", "2025-01-01T00:00:00.000Z")

        safe_items  = entry.get("safeHtmlItem", [])
        resp_html   = safe_items[0].get("html", "") if safe_items else ""
        resp_text   = html_to_text(resp_html)

        conversations.append({
            "conversationId": conv_id,
            "user":           USER_ID,
            "endpoint":       ENDPOINT,
            "model":          MODEL,
            "title":          user_prompt[:200],
            "messages":       [user_msg_id, asst_msg_id],
            "tags":           [IMPORT_TAG],
            "files":          [],
            "isArchived":     False,
            "_meiliIndex":    True,
            "createdAt":      {"$date": ts},
            "updatedAt":      {"$date": ts},
        })

        messages.append({
            "messageId":       user_msg_id,
            "conversationId":  conv_id,
            "user":            USER_ID,
            "endpoint":        ENDPOINT,
            "model":           MODEL,
            "sender":          "user",
            "text":            user_prompt,
            "isCreatedByUser": True,
            "error":           False,
            "unfinished":      False,
            "parentMessageId": NULL_UUID,
            "_meiliIndex":     True,
            "createdAt":       {"$date": ts},
            "updatedAt":       {"$date": ts},
        })

        messages.append({
            "messageId":       asst_msg_id,
            "conversationId":  conv_id,
            "user":            USER_ID,
            "endpoint":        ENDPOINT,
            "model":           MODEL,
            "sender":          SENDER,
            "text":            resp_text,
            "isCreatedByUser": False,
            "error":           False,
            "unfinished":      False,
            "parentMessageId": user_msg_id,
            "_meiliIndex":     True,
            "createdAt":       {"$date": ts},
            "updatedAt":       {"$date": ts},
        })

    return conversations, messages


def check_existing(sock_path: str, container: str) -> int:
    """Return count of already-imported Gemini conversations."""
    js = (
        f'db = db.getSiblingDB("{DB}"); '
        f'print(db.conversations.countDocuments({{tags: "{IMPORT_TAG}"}}));'
    )
    out = docker_exec_js(sock_path, container, js)
    try:
        return int(out.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return 0


def insert_batch(sock_path: str, container: str, collection: str,
                 docs: list, dry_run: bool) -> int:
    """Insert a batch of documents via mongosh insertMany. Returns inserted count."""
    if dry_run:
        print(f"  [dry-run] would insert {len(docs)} into {collection}")
        return len(docs)

    js_docs = json.dumps(docs, separators=(",", ":"))
    js = (
        f'db = db.getSiblingDB("{DB}"); '
        f'var r = db.{collection}.insertMany({js_docs}, {{ordered: false}}); '
        f'print(Object.keys(r.insertedIds).length);'
    )
    out = docker_exec_js(sock_path, container, js)
    try:
        return int(out.strip().splitlines()[-1])
    except (ValueError, IndexError):
        print(f"  Warning: unexpected output from insert: {repr(out[:200])}")
        return len(docs)


def run_import(export_path: str, batch_size: int, dry_run: bool, sock_path: str, force: bool = False):
    print(f"Loading export: {export_path}")
    with open(export_path, encoding="utf-8") as f:
        raw = json.load(f)

    print(f"Entries in export: {len(raw)}")

    # Check for prior imports
    if not dry_run:
        existing = check_existing(sock_path, CONTAINER)
        if existing > 0:
            print(f"⚠️  Found {existing} previously imported Gemini conversations in MongoDB.")
            if not force:
                print("Use --force to import anyway (may create duplicates).")
                print("Aborted.")
                return
            print("  --force set, continuing...")

    conversations, messages = convert_entries(raw)
    print(f"Converted: {len(conversations)} conversations, {len(messages)} messages")

    if dry_run:
        print("\n[dry-run mode — no data will be written]\n")

    # Insert conversations in batches
    print(f"\nInserting conversations (batch size {batch_size})...")
    total_convos = 0
    for i in range(0, len(conversations), batch_size):
        batch = conversations[i:i + batch_size]
        n = insert_batch(sock_path, CONTAINER, "conversations", batch, dry_run)
        total_convos += n
        pct = min(100, int((i + len(batch)) / len(conversations) * 100))
        print(f"  {pct}% — inserted {total_convos}/{len(conversations)} conversations", end="\r")
    print(f"\n  Done: {total_convos} conversations inserted")

    # Insert messages in batches
    print(f"\nInserting messages (batch size {batch_size})...")
    total_msgs = 0
    for i in range(0, len(messages), batch_size):
        batch = messages[i:i + batch_size]
        n = insert_batch(sock_path, CONTAINER, "messages", batch, dry_run)
        total_msgs += n
        pct = min(100, int((i + len(batch)) / len(messages) * 100))
        print(f"  {pct}% — inserted {total_msgs}/{len(messages)} messages", end="\r")
    print(f"\n  Done: {total_msgs} messages inserted")

    print(f"\n✅ Import complete: {total_convos} conversations, {total_msgs} messages")
    if not dry_run:
        print(f"\nNote: LibreChat's Meilisearch sync runs automatically when users interact.")
        print(f"To force re-index, restart the LibreChat container.")


# ─── CLI ──────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="Import Gemini export into LibreChat MongoDB")
    ap.add_argument("--export",     default=DEFAULT_EXPORT, help="Path to MyActivity.json")
    ap.add_argument("--batch-size", type=int, default=BATCH_SIZE, help="Docs per mongosh call")
    ap.add_argument("--dry-run",    action="store_true", help="Parse + convert only, no writes")
    ap.add_argument("--force",      action="store_true", help="Skip duplicate check confirmation")
    ap.add_argument("--socket",     default=DOCKER_SOCKET, help="Docker socket path")
    args = ap.parse_args()

    if not os.path.exists(args.export):
        print(f"ERROR: Export file not found: {args.export}", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.socket):
        print(f"ERROR: Docker socket not found: {args.socket}", file=sys.stderr)
        sys.exit(1)

    run_import(args.export, args.batch_size, args.dry_run, args.socket, args.force)


if __name__ == "__main__":
    main()
