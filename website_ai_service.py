import json
import logging
import math
import os
import re
import time
from logging.handlers import RotatingFileHandler
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import requests
from requests.exceptions import RequestException
from flask import Flask, jsonify, request
from flask_cors import CORS


BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Paths to your manual sources
MANUAL_TEX_DIR = os.path.join(BASE_DIR,  "Tex")#LLM端的tex实际路径
MANUAL_TEX_ENTRY = os.path.join(BASE_DIR, "manual.tex")

# Index storage
INDEX_PATH = os.path.join(BASE_DIR, "website_ai_index.json")

# Ollama settings
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_LLM_MODEL = os.getenv("OLLAMA_LLM_MODEL", "qwen7b")
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

# Chat mode: "rag" = embed question + retrieve chunks; "full" = inject full manual text (no embeddings).
CHAT_MODE = os.getenv("CHAT_MODE", "rag").strip().lower()
# When CHAT_MODE=full, manual text is capped (LLM context is finite; raise if your model allows more).
MAX_FULL_MANUAL_CHARS = int(os.getenv("MAX_FULL_MANUAL_CHARS", "48000"))

# Retrieval settings (used only when CHAT_MODE=rag)
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "4"))
MAX_MATERIAL_CHARS = int(os.getenv("MAX_MATERIAL_CHARS", "6000"))

# 多轮对话：传给 Ollama 的最大条数（user/assistant 各算一条），防止上下文过长
MAX_CHAT_HISTORY_MESSAGES = int(os.getenv("MAX_CHAT_HISTORY_MESSAGES", "40"))

# 对话请求日志（含客户端 IP）；CHAT_LOG_ENABLED=0 可关闭
CHAT_LOG_ENABLED = os.getenv("CHAT_LOG_ENABLED", "1").strip().lower() not in (
    "0",
    "false",
    "no",
    "",
)
CHAT_LOG_PATH = os.getenv("CHAT_LOG_PATH", os.path.join(BASE_DIR, "website_chat.log"))
CHAT_LOG_MAX_BYTES = int(os.getenv("CHAT_LOG_MAX_BYTES", str(10 * 1024 * 1024)))
CHAT_LOG_BACKUP_COUNT = int(os.getenv("CHAT_LOG_BACKUP_COUNT", "5"))
# 写入日志时单条 content 最大字符数，避免历史过长撑爆文件
CHAT_LOG_MAX_CONTENT_PER_MSG = int(os.getenv("CHAT_LOG_MAX_CONTENT_PER_MSG", "4000"))

# Chunking settings (text-only for retrieval)
CHUNK_MIN_CHARS = int(os.getenv("CHUNK_MIN_CHARS", "200"))
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "2200"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "200"))


app = Flask(__name__)
CORS(app)

_chat_logger = logging.getLogger("msp_website_chat")
_chat_logger.setLevel(logging.INFO)
_chat_logger.propagate = False
if CHAT_LOG_ENABLED:
    _chat_handler = RotatingFileHandler(
        CHAT_LOG_PATH,
        maxBytes=max(CHAT_LOG_MAX_BYTES, 1024 * 1024),
        backupCount=max(CHAT_LOG_BACKUP_COUNT, 1),
        encoding="utf-8",
    )
    _chat_handler.setFormatter(
        logging.Formatter("%(asctime)s\t%(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    )
    _chat_logger.addHandler(_chat_handler)


def _client_ip() -> str:
    """优先使用反向代理转发的真实客户端 IP。"""
    xff = (request.headers.get("X-Forwarded-For") or "").strip()
    if xff:
        return xff.split(",")[0].strip()
    xri = (request.headers.get("X-Real-IP") or "").strip()
    if xri:
        return xri
    return (request.remote_addr or "").strip() or "unknown"


def _truncate_for_log(text: str, max_len: int) -> str:
    if max_len <= 0:
        return ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def log_chat_request(question: str, history: Any, extra: Optional[Dict[str, Any]] = None) -> None:
    """将本轮用户问题、history 摘要与客户端 IP 写入日志文件（一行 JSON）。"""
    if not CHAT_LOG_ENABLED:
        return
    hist_summary: List[Dict[str, str]] = []
    if isinstance(history, list):
        for m in history:
            if not isinstance(m, dict):
                continue
            role = str(m.get("role", "")).strip()
            content = _truncate_for_log(
                str(m.get("content", "")), CHAT_LOG_MAX_CONTENT_PER_MSG
            )
            if not role:
                continue
            hist_summary.append({"role": role, "content": content})

    rec: Dict[str, Any] = {
        "ip": _client_ip(),
        "question": _truncate_for_log(question, CHAT_LOG_MAX_CONTENT_PER_MSG),
        "history": hist_summary,
    }
    if extra:
        rec.update(extra)
    try:
        _chat_logger.info(json.dumps(rec, ensure_ascii=False))
    except Exception:
        # 日志失败不影响接口
        pass


def _post_json(url: str, payload: Dict[str, Any], timeout_s: int = 600) -> Dict[str, Any]:
    r = requests.post(url, json=payload, timeout=timeout_s)
    r.raise_for_status()
    return r.json()


def _ollama_error_detail(exc: BaseException) -> str:
    if isinstance(exc, requests.HTTPError) and exc.response is not None:
        snippet = (exc.response.text or "")[:400].strip()
        return f"HTTP {exc.response.status_code} from Ollama" + (f": {snippet}" if snippet else "")
    return str(exc) or type(exc).__name__


def get_embedding(text: str) -> List[float]:
    payload = {"model": OLLAMA_EMBED_MODEL, "prompt": text}
    data = _post_json(f"{OLLAMA_BASE_URL}/api/embeddings", payload, timeout_s=600)
    emb = data.get("embedding")
    if not isinstance(emb, list):
        raise RuntimeError(f"Unexpected embeddings response: keys={list(data.keys())}")
    return emb


def cosine_similarity(a: List[float], b: List[float]) -> float:
    # Avoid numpy; keep it simple.
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for i in range(min(len(a), len(b))):
        dot += a[i] * b[i]
        norm_a += a[i] * a[i]
        norm_b += b[i] * b[i]
    if norm_a <= 0 or norm_b <= 0:
        return -1.0
    return dot / (math.sqrt(norm_a) * math.sqrt(norm_b))


def clean_latex_to_text(s: str) -> str:
    # Remove comments
    s = re.sub(r"%.*$", "", s, flags=re.MULTILINE)

    # Replace common line breaks
    s = s.replace("\\\\", "\n")

    # Remove environments (best-effort)
    s = re.sub(r"\\begin\{[^}]+\}", "", s)
    s = re.sub(r"\\end\{[^}]+\}", "", s)

    # Convert \command{...} -> ...
    s = re.sub(r"\\[a-zA-Z@]+(\[[^\]]*\])?\{([^}]*)\}", r"\2", s)

    # Remove remaining commands like \command or \command[...]
    s = re.sub(r"\\[a-zA-Z@]+(\[[^\]]*\])?", "", s)

    # Remove braces and extra whitespace
    s = s.replace("{", "").replace("}", "")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def chunk_text(text: str, chunk_size: int, overlap: int) -> List[str]:
    if len(text) <= chunk_size:
        return [text]
    chunks: List[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + chunk_size)
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = max(0, end - overlap)
    return chunks


HEADING_RE = re.compile(r"\\(chapter|section|subsection)\{([^}]*)\}")


def parse_tex_file_to_chunks(tex_path: str) -> List[Dict[str, Any]]:
    with open(tex_path, "r", encoding="utf-8", errors="ignore") as f:
        raw = f.read()

    lines = raw.splitlines()
    chunks: List[Dict[str, Any]] = []

    current_title = os.path.basename(tex_path)
    buf: List[str] = []

    def flush_buf():
        nonlocal buf, current_title
        if not buf:
            return
        block = "\n".join(buf).strip()
        buf = []
        if not block:
            return

        text = clean_latex_to_text(block)
        if len(text) < CHUNK_MIN_CHARS:
            return

        for idx, part in enumerate(chunk_text(text, CHUNK_SIZE, CHUNK_OVERLAP)):
            chunks.append(
                {
                    "id": f"{os.path.basename(tex_path)}::{idx}",
                    "source": os.path.relpath(tex_path, BASE_DIR),
                    "title": current_title,
                    "text": part,
                }
            )

    for line in lines:
        m = HEADING_RE.search(line)
        if m:
            # If we hit a heading, flush previous paragraph buffer.
            flush_buf()
            current_title = m.group(2).strip() or current_title
            continue

        if line.strip() == "":
            flush_buf()
        else:
            buf.append(line)

    flush_buf()
    return chunks


def build_index() -> Dict[str, Any]:
    tex_files: List[str] = []
    if os.path.isfile(MANUAL_TEX_ENTRY):
        # We do not parse manual.tex directly; we parse Tex/*, but keep entry for completeness.
        pass

    if os.path.isdir(MANUAL_TEX_DIR):
        for name in os.listdir(MANUAL_TEX_DIR):
            if name.lower().endswith(".tex"):
                tex_files.append(os.path.join(MANUAL_TEX_DIR, name))

    tex_files.sort()

    chunks: List[Dict[str, Any]] = []
    for p in tex_files:
        parts = parse_tex_file_to_chunks(p)
        chunks.extend(parts)

    # Deduplicate by (source,title,text prefix) if needed (lightweight).
    seen = set()
    unique_chunks: List[Dict[str, Any]] = []
    for c in chunks:
        key = (c["source"], c["title"], c["text"][:60])
        if key in seen:
            continue
        seen.add(key)
        unique_chunks.append(c)

    chunks = unique_chunks

    # Build embeddings
    for i, c in enumerate(chunks):
        if i % 10 == 0:
            print(f"[index] embedding {i+1}/{len(chunks)} ...")
        c["embedding"] = get_embedding(c["text"])
        time.sleep(0.05)

    index = {
        "llm_model": OLLAMA_LLM_MODEL,
        "embed_model": OLLAMA_EMBED_MODEL,
        "chunks": chunks,
        "built_from": {"manual_tex_dir": os.path.relpath(MANUAL_TEX_DIR, BASE_DIR)},
    }
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False)
    return index


def load_index() -> Dict[str, Any]:
    if not os.path.exists(INDEX_PATH):
        return build_index()
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        index = json.load(f)
    return index


INDEX: Optional[Dict[str, Any]] = None
FULL_MANUAL_TEXT_CACHE: Optional[str] = None


def _collect_tex_paths() -> List[str]:
    tex_files: List[str] = []
    if os.path.isdir(MANUAL_TEX_DIR):
        for name in os.listdir(MANUAL_TEX_DIR):
            if name.lower().endswith(".tex"):
                tex_files.append(os.path.join(MANUAL_TEX_DIR, name))
    tex_files.sort()
    return tex_files


def build_full_manual_plain_text() -> str:
    """All manual chapters as plain text (no embeddings). Used when CHAT_MODE=full."""
    parts: List[str] = []
    for p in _collect_tex_paths():
        for c in parse_tex_file_to_chunks(p):
            title = str(c.get("title", "")).strip()
            body = str(c.get("text", "")).strip()
            if not body:
                continue
            if title:
                parts.append(f"## {title}\n{body}")
            else:
                parts.append(body)
    return "\n\n".join(parts).strip()


def get_full_manual_for_prompt() -> Tuple[str, List[Dict[str, str]]]:
    global FULL_MANUAL_TEXT_CACHE
    if FULL_MANUAL_TEXT_CACHE is None:
        FULL_MANUAL_TEXT_CACHE = build_full_manual_plain_text()
    text = FULL_MANUAL_TEXT_CACHE
    if len(text) > MAX_FULL_MANUAL_CHARS:
        text = text[:MAX_FULL_MANUAL_CHARS] + "\n\n[... 说明书已截断，请提高 MAX_FULL_MANUAL_CHARS 或改用 CHAT_MODE=rag ...]"
    sources = [
        {
            "title": "说明书全文（注入上下文）",
            "source": os.path.relpath(MANUAL_TEX_DIR, BASE_DIR),
        }
    ]
    return text, sources


@app.get("/health")
def health():
    return jsonify(
        {
            "ok": True,
            "ollama_base_url": OLLAMA_BASE_URL,
            "llm_model": OLLAMA_LLM_MODEL,
            "chat_mode": CHAT_MODE,
        }
    )


@app.post("/api/rebuild")
def api_rebuild():
    global INDEX
    INDEX = build_index()
    return jsonify({"ok": True, "chunks": len(INDEX.get("chunks", []))})


@app.post("/api/chat")
def api_chat():
    global INDEX

    payload = request.get_json(force=True) or {}
    question = (payload.get("question") or "").strip()
    if not question:
        return jsonify({"answer": "", "sources": []}), 400

    log_chat_request(question, payload.get("history"))

    try:
        if CHAT_MODE == "full":
            materials, sources = get_full_manual_for_prompt()
        else:
            if INDEX is None:
                INDEX = load_index()

            chunks: List[Dict[str, Any]] = INDEX["chunks"]

            q_emb = get_embedding(question)
            scored: List[Tuple[float, Dict[str, Any]]] = []
            for c in chunks:
                score = cosine_similarity(q_emb, c["embedding"])
                scored.append((score, c))

            scored.sort(key=lambda x: x[0], reverse=True)
            top = scored[: max(1, RAG_TOP_K)]

            materials_parts: List[str] = []
            sources = []
            total_chars = 0
            for score, c in top:
                text = c["text"].strip()
                if not text:
                    continue

                part = f"[source: {c.get('source','')}; title: {c.get('title','')}; score: {score:.4f}]\n{text}\n"
                if total_chars + len(part) > MAX_MATERIAL_CHARS:
                    break
                materials_parts.append(part)
                total_chars += len(part)
                sources.append(
                    {
                        "title": str(c.get("title", "")),
                        "source": str(c.get("source", "")),
                    }
                )

            materials = "\n".join(materials_parts)

        # Extra nudge when the user likely wants setup steps (RAG may still return generic intro chunks).
        setup_nudge = ""
        if re.search(r"安装|环境|配置|依赖|系统要求|下载|部署|运行要求", question):
            setup_nudge = (
                "\n【针对本题】用户似乎在问安装或运行环境：请优先依据参考片段里与安装/依赖/系统要求/配置相关的"
                "内容作答，尽量用分步说明；若片段里没有具体步骤，请明确说明「手册片段未包含详细安装步骤」，"
                "不要用大段软件总体介绍代替安装说明。\n"
            )

        system_prompt = (
            "你是微磁学模拟平台（MSP）官网/手册侧的客服助手。\n"
            "\n"
            "【何时用参考片段】\n"
            "仅当用户问题与 MSP 或其说明书内容相关（例如：软件是什么、如何安装配置、GUI/模拟/理论、故障与使用建议等）时，"
            "以下方「参考片段」为主要依据作答；可合理概括与转述，不要编造片段中不存在的关键事实或版本号。\n"
            "\n"
            "【何时不要用参考片段】\n"
            "若问题与 MSP 无关（例如普通闲聊、常识、简单算术、其他软件或领域），应直接简洁作答，"
            "不要复述、摘抄或改写参考片段里的说明书文字来凑答案。\n"
            "\n"
            "【材料不足时】\n"
            "若问题与 MSP 相关但参考片段未覆盖，先说明片段中缺少哪类信息，再可用常识做简短补充，"
            "并明确标注「以下非手册原文，为一般性说明」。\n"
            "\n"
            "【风格】\n"
            "回答使用简体中文；紧扣用户问题，避免无故输出长篇产品总述；需要步骤时用编号分步。\n"
        )

        user_prompt = (
            f"用户问题：\n{question}\n"
            f"{setup_nudge}"
            "\n"
            "以下是从 MSP 说明书（TeX 解析后的文本）中检索得到的参考片段，供你在「与 MSP 相关」时使用；"
            "若与当前问题无关，请忽略整段参考内容。\n"
            "————————————————\n"
            f"{materials}\n"
            "————————————————\n"
            "\n"
            "请用简体中文作答。"
        )

        # 多轮：前端会传 history（含本轮用户句）；RAG 仍只针对当前 question 检索
        hist_raw = payload.get("history")
        if not isinstance(hist_raw, list):
            hist_raw = []
        if MAX_CHAT_HISTORY_MESSAGES > 0 and len(hist_raw) > MAX_CHAT_HISTORY_MESSAGES:
            hist_raw = hist_raw[-MAX_CHAT_HISTORY_MESSAGES:]

        ollama_messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]
        augmented_last_user = False
        if not hist_raw:
            ollama_messages.append({"role": "user", "content": user_prompt})
            augmented_last_user = True
        else:
            n = len(hist_raw)
            for idx, msg in enumerate(hist_raw):
                if not isinstance(msg, dict):
                    continue
                role = str(msg.get("role", "")).strip().lower()
                content = str(msg.get("content", "")).strip()
                if role not in ("user", "assistant") or not content:
                    continue
                if idx == n - 1 and role == "user":
                    ollama_messages.append({"role": "user", "content": user_prompt})
                    augmented_last_user = True
                else:
                    ollama_messages.append({"role": role, "content": content})
            if not augmented_last_user:
                ollama_messages.append({"role": "user", "content": user_prompt})

        chat_payload = {
            "model": OLLAMA_LLM_MODEL,
            "messages": ollama_messages,
            "stream": False,
            "options": {"temperature": 0.2},
        }

        data = _post_json(f"{OLLAMA_BASE_URL}/api/chat", chat_payload, timeout_s=600)
        # Ollama format: { "message": { "role": "...", "content": "..." } }
        msg = data.get("message") or {}
        answer = msg.get("content") or data.get("response") or ""

        return jsonify({"answer": answer, "sources": sources})
    except (RequestException, RuntimeError) as e:
        detail = _ollama_error_detail(e)
        return (
            jsonify(
                {
                    "answer": "",
                    "sources": [],
                    "error": "ollama_error",
                    "detail": detail,
                }
            ),
            503,
        )


if __name__ == "__main__":
    # Build index on first start if needed (RAG mode only).
    print(
        f"[server] Starting. LLM={OLLAMA_LLM_MODEL}, EMBED={OLLAMA_EMBED_MODEL}, CHAT_MODE={CHAT_MODE}"
    )
    if CHAT_MODE == "full":
        print("[server] Full-manual mode: skipping embedding index on startup.")
        if os.getenv("PREWARM_FULL_MANUAL", "1") == "1":
            t0 = time.time()
            _mat, _ = get_full_manual_for_prompt()
            print(f"[server] Full manual cached. chars={len(_mat)} took {time.time()-t0:.2f}s")
    elif os.getenv("BUILD_INDEX_ON_START", "1") == "1":
        print("[server] Loading/building index ...")
        INDEX = load_index()
        print(f"[server] Index ready. chunks={len(INDEX.get('chunks', []))}")
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    app.run(host=host, port=port, debug=False, threaded=True)

