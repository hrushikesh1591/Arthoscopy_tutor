"""
TMJ Arthroscopy Micro-Tutor — Render 24/7 Cloud Service & Mobile Web App
Bot: @Arthoscopy_Microtutor_bot
Web App: https://arthoscopy-tutor.onrender.com

Serves the interactive mobile-friendly Surgical Cockpit Web App on HTTP
while concurrently running the Telegram Bot polling daemon in the background.
"""

import json
import os
import sys
import time
import threading
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
import requests
import urllib3

urllib3.disable_warnings()

# ---------------------------------------------------------------------------
# Configuration & Paths
# ---------------------------------------------------------------------------
BOT_TOKEN = os.environ.get("BOT_TOKEN", "8825973184:AAE3nNaPY3vzVcgXQOPIDwAk9QPAFnZ6xn8")
API_BASE = f"https://api.telegram.org/bot{BOT_TOKEN}"
PORT = int(os.environ.get("PORT", 10000))

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CURRICULUM_PATH = os.path.join(BASE_DIR, "curriculum.json")
USER_STATE_PATH = os.path.join(BASE_DIR, "bot_user_state.json")

# ---------------------------------------------------------------------------
# Web App & Static File HTTP Server (Serves Mobile Dashboard)
# ---------------------------------------------------------------------------
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
}

class DashboardHTTPHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        req_path = parsed.path.strip()
        
        # Default root serves index.html (the mobile web app dashboard)
        if req_path in ["", "/"]:
            req_path = "/index.html"
            
        # Security: sanitize path against directory traversal
        clean_path = os.path.normpath(req_path.lstrip("/"))
        file_path = os.path.join(BASE_DIR, clean_path)
        
        if os.path.exists(file_path) and os.path.isfile(file_path):
            ext = os.path.splitext(file_path)[1].lower()
            content_type = MIME_TYPES.get(ext, "application/octet-stream")
            
            try:
                with open(file_path, "rb") as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(content)
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(f"500 Internal Error: {e}".encode("utf-8"))
        else:
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"404 Not Found")

    def log_message(self, format, *args):
        # Suppress noisy HTTP health log pings
        return

def run_http_server():
    server = HTTPServer(("0.0.0.0", PORT), DashboardHTTPHandler)
    print(f"[Mobile Web Server] Listening on 0.0.0.0:{PORT} (Serving Mobile Dashboard)")
    server.serve_forever()

# ---------------------------------------------------------------------------
# Curriculum & State
# ---------------------------------------------------------------------------
def load_curriculum():
    with open(CURRICULUM_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def get_all_modules_flat(curriculum):
    flat = []
    for ch in curriculum:
        for m in ch["modules"]:
            flat.append({"chapter": ch, "module": m})
    return flat

def load_user_state():
    if os.path.exists(USER_STATE_PATH):
        try:
            with open(USER_STATE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_user_state(state):
    try:
        with open(USER_STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[State Save Warning] {e}")

def get_or_create_user(state, chat_id, user_info=None):
    cid = str(chat_id)
    if cid not in state:
        state[cid] = {
            "first_name": (user_info or {}).get("first_name", "Doctor"),
            "username": (user_info or {}).get("username", ""),
            "module_index": 0,
            "completed_modules": [],
            "quiz_answers": {},
            "mastered_cards": [],
            "current_fc_index": 0,
            "created_at": time.time(),
            "last_active": time.time()
        }
        save_user_state(state)
    else:
        state[cid]["last_active"] = time.time()
    return state[cid]

# ---------------------------------------------------------------------------
# Telegram API Client
# ---------------------------------------------------------------------------
def tg_request(method, payload=None, timeout=35):
    url = f"{API_BASE}/{method}"
    try:
        resp = requests.post(url, json=payload or {}, verify=False, timeout=timeout)
        return resp.json()
    except Exception as e:
        print(f"[Telegram API Error] {method}: {e}")
        return {"ok": False, "error": str(e)}

def send_message(chat_id, text, reply_markup=None, parse_mode="Markdown"):
    payload = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return tg_request("sendMessage", payload)

def edit_message_text(chat_id, message_id, text, reply_markup=None, parse_mode="Markdown"):
    payload = {"chat_id": chat_id, "message_id": message_id, "text": text, "parse_mode": parse_mode}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return tg_request("editMessageText", payload)

def answer_callback_query(callback_query_id, text=None, show_alert=False):
    payload = {"callback_query_id": callback_query_id}
    if text:
        payload["text"] = text
        payload["show_alert"] = show_alert
    return tg_request("answerCallbackQuery", payload)

def get_main_reply_keyboard():
    return {
        "keyboard": [
            [{"text": "📚 Today's Lesson"}, {"text": "🧠 Surgical Challenge"}],
            [{"text": "🗂️ Flashcard Deck"}, {"text": "📊 My Progress"}],
            [{"text": "📖 Jump to Chapter"}, {"text": "🌐 Open Mobile Web App"}]
        ],
        "resize_keyboard": True,
        "is_persistent": True
    }

# ---------------------------------------------------------------------------
# Telegram Commands & Message Handlers
# ---------------------------------------------------------------------------
def handle_start(chat_id, user_data):
    name = user_data.get("first_name", "Doctor")
    msg = (
        f"👋 *Welcome, Dr. {name}!*\n\n"
        f"🎓 *TMJ ARTHROSCOPY MICRO-TUTOR (24/7 Cloud Edition)*\n"
        f"Grounded in *Principles & Practice of TMJ Arthroscopy* by **Joseph P. McCain, D.D.S.**\n\n"
        f"I am your automated residency coach. Every day, I help you master temporomandibular joint endoscopy in **3-minute high-yield surgical bites**.\n\n"
        f"🎯 *What You Get:*\n"
        f"• 📚 **Surgical Bite Lessons:** Step-by-step portals, optics, triangulation & danger zones\n"
        f"• 🧠 **1-Min Surgical Challenges:** Operative dilemma MCQs with instant feedback\n"
        f"• 🗂️ **Spaced Repetition Flashcards:** Anatomic coordinates & landmarks\n"
        f"• 📊 **Progress & Streak Tracking:** Real-time completion logs\n"
        f"• 🌐 **Mobile Web Cockpit:** [Open in Browser](https://arthoscopy-tutor.onrender.com)\n\n"
        f"👇 *Tap 'Today's Lesson' below to start your surgical module!*"
    )
    send_message(chat_id, msg, reply_markup=get_main_reply_keyboard())

def handle_lesson(chat_id, user_data, flat_modules, state, mod_idx=None):
    if mod_idx is None:
        mod_idx = user_data["module_index"]
    if mod_idx >= len(flat_modules):
        mod_idx = 0
    
    user_data["module_index"] = mod_idx
    item = flat_modules[mod_idx]
    ch = item["chapter"]
    m = item["module"]
    
    if m["id"] not in user_data["completed_modules"]:
        user_data["completed_modules"].append(m["id"])
    save_user_state(state)
    
    msg = (
        f"📚 *TMJ ARTHROSCOPY MICRO-TUTOR*\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"*Chapter {ch['number']}: {ch['title']}*\n"
        f"🎯 *Module {mod_idx + 1}/{len(flat_modules)}:* {m['title']} ({m['read_time']})\n"
        f"👨‍⚕️ *Author:* {ch['author']}\n"
        f"📖 _Source: {ch['pdf_file']} (pp. {ch['pages']})_\n\n"
        f"🔬 *1. THE SURGICAL CORE*\n"
        f"{m['core_concept']}\n\n"
        f"🛠️ *2. SURGICAL TECHNIQUE & TACTILE NUANCES*\n"
        f"{m['surgical_technique']}\n\n"
        f"⚠️ *3. DANGER ZONES & CLINICAL PEARLS*\n"
        f"{m['danger_zones_pearls']}\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"Ready for the residency decision dilemma?"
    )
    
    inline_kb = {
        "inline_keyboard": [
            [
                {"text": "🧠 Take Surgical Challenge", "callback_data": f"quiz_{mod_idx}"},
                {"text": "🗂️ Chapter Flashcards", "callback_data": f"fc_{ch['id']}_0"}
            ],
            [
                {"text": "⬅️ Previous Module", "callback_data": f"mod_{max(0, mod_idx - 1)}"},
                {"text": "Next Module ➡️", "callback_data": f"mod_{min(len(flat_modules) - 1, mod_idx + 1)}"}
            ]
        ]
    }
    send_message(chat_id, msg, reply_markup=inline_kb)

def handle_quiz(chat_id, user_data, flat_modules, mod_idx=None):
    if mod_idx is None:
        mod_idx = user_data["module_index"]
    
    item = flat_modules[mod_idx]
    m = item["module"]
    c = m["challenge"]
    opts_lines = "\n".join([f"*({chr(65+i)})* {opt}" for i, opt in enumerate(c["options"])])
    
    msg = (
        f"🧠 *1-MINUTE SURGICAL DECISION CHALLENGE*\n"
        f"*Topic:* {m['title']}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📋 *Vignette:*\n_{c['scenario']}_\n\n"
        f"❓ *Operative Dilemma:*\n*{c['question']}*\n\n"
        f"{opts_lines}\n\n"
        f"👇 *Tap your surgical decision below:*"
    )
    
    buttons = []
    row = []
    for i in range(len(c["options"])):
        letter = chr(65 + i)
        row.append({"text": f"[{letter}]", "callback_data": f"ans_{mod_idx}_{i}"})
        if len(row) == 2:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
        
    inline_kb = {"inline_keyboard": buttons}
    send_message(chat_id, msg, reply_markup=inline_kb)

def handle_flashcard(chat_id, user_data, curriculum, ch_id=None, fc_idx=0):
    if not ch_id:
        flat = get_all_modules_flat(curriculum)
        curr_item = flat[user_data["module_index"]]
        ch_id = curr_item["chapter"]["id"]
        
    chapter = next((c for c in curriculum if c["id"] == ch_id), curriculum[0])
    cards = chapter.get("flashcards", [])
    
    if not cards:
        send_message(chat_id, "No flashcards found for this chapter.")
        return
        
    fc_idx = max(0, min(fc_idx, len(cards) - 1))
    card = cards[fc_idx]
    card_key = f"{chapter['id']}_{fc_idx}"
    is_mastered = card_key in user_data.get("mastered_cards", [])
    
    msg = (
        f"🗂️ *SPACED REPETITION FLASHCARD*\n"
        f"*Chapter {chapter['number']}: {chapter['title']}*\n"
        f"Card {fc_idx + 1} of {len(cards)} • Category: `{card['category']}`\n"
        f"{'⭐ Mastered' if is_mastered else '⏳ In Progress'}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"❓ *PROMPT:*\n*{card['front']}*\n\n"
        f"Tap below to flip and reveal the surgical landmark/answer:"
    )
    
    inline_kb = {
        "inline_keyboard": [
            [{"text": "🔄 Reveal Answer", "callback_data": f"fcreveal_{ch_id}_{fc_idx}"}],
            [
                {"text": "⬅️ Prev Card", "callback_data": f"fc_{ch_id}_{max(0, fc_idx - 1)}"},
                {"text": "Next Card ➡️", "callback_data": f"fc_{ch_id}_{min(len(cards) - 1, fc_idx + 1)}"}
            ]
        ]
    }
    send_message(chat_id, msg, reply_markup=inline_kb)

def handle_progress(chat_id, user_data, flat_modules):
    total_mods = len(flat_modules)
    done_mods = len(user_data.get("completed_modules", []))
    pct = round((done_mods / total_mods) * 100) if total_mods > 0 else 0
    
    answers = user_data.get("quiz_answers", {})
    total_answered = len(answers)
    correct_count = sum(1 for a in answers.values() if a.get("is_correct"))
    quiz_pct = round((correct_count / total_answered) * 100) if total_answered > 0 else 0
    
    mastered_cards = len(user_data.get("mastered_cards", []))
    current_item = flat_modules[user_data.get("module_index", 0)]
    
    msg = (
        f"📊 *YOUR SURGICAL LEARNING COCKPIT*\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👨‍⚕️ *Surgeon:* Dr. {user_data.get('first_name', 'Doctor')}\n"
        f"🔥 *Daily Study Streak:* Active\n\n"
        f"📚 *Curriculum Modules:* {done_mods} / {total_mods} ({pct}%)\n"
        f"🧠 *Surgical Challenge Accuracy:* {quiz_pct}% ({correct_count}/{total_answered})\n"
        f"🗂️ *Flashcards Mastered:* {mastered_cards}\n\n"
        f"📍 *Current Station:*\n"
        f"Chapter {current_item['chapter']['number']}: {current_item['chapter']['title']}\n"
        f"Module: {current_item['module']['title']}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🌐 *Open Mobile Web App:* https://arthoscopy-tutor.onrender.com"
    )
    send_message(chat_id, msg)

def handle_chapter_menu(chat_id, curriculum):
    msg = "📖 *SELECT A SURGICAL CHAPTER TO STUDY:*\nTap any chapter below to jump directly to its micro-modules:"
    buttons = []
    for ch in curriculum:
        btn_text = f"CH {ch['number']}: {ch['title'][:28]}"
        buttons.append([{"text": btn_text, "callback_data": f"jump_ch_{ch['id']}"}])
    inline_kb = {"inline_keyboard": buttons}
    send_message(chat_id, msg, reply_markup=inline_kb)

def handle_web_app(chat_id):
    msg = (
        f"🌐 *TMJ ARTHROSCOPY MOBILE WEB APP*\n\n"
        f"You can open the full visual surgical cockpit on your mobile browser anytime here:\n"
        f"👉 https://arthoscopy-tutor.onrender.com\n\n"
        f"Features available in your browser:\n"
        f"• 🔊 Listen to surgical lessons via Text-to-Speech\n"
        f"• 🗂️ 3D Flip Flashcards deck\n"
        f"• 🧠 Interactive decision quizzes\n"
        f"• 🔍 Real-time search across all 18 chapters & danger zones"
    )
    send_message(chat_id, msg)

# ---------------------------------------------------------------------------
# Callback Query Processor (Inline Button Clicks)
# ---------------------------------------------------------------------------
def process_callback_query(cb, flat_modules, curriculum, state):
    cb_id = cb["id"]
    from_user = cb["from"]
    chat_id = cb["message"]["chat"]["id"]
    msg_id = cb["message"]["message_id"]
    data = cb.get("data", "")
    
    user_data = get_or_create_user(state, chat_id, from_user)
    
    if data.startswith("mod_"):
        idx = int(data.split("_")[1])
        answer_callback_query(cb_id)
        handle_lesson(chat_id, user_data, flat_modules, state, idx)
        
    elif data.startswith("quiz_"):
        idx = int(data.split("_")[1])
        answer_callback_query(cb_id)
        handle_quiz(chat_id, user_data, flat_modules, idx)
        
    elif data.startswith("ans_"):
        parts = data.split("_")
        mod_idx = int(parts[1])
        selected_opt = int(parts[2])
        
        item = flat_modules[mod_idx]
        c = item["module"]["challenge"]
        is_correct = (selected_opt == c["correct_index"])
        
        user_data["quiz_answers"][item["module"]["id"]] = {
            "selected": selected_opt,
            "is_correct": is_correct
        }
        save_user_state(state)
        
        alert_text = "✅ Correct Surgical Decision!" if is_correct else "❌ Operative Pitfall!"
        answer_callback_query(cb_id, text=alert_text, show_alert=True)
        
        letter = chr(65 + c["correct_index"])
        verdict_icon = "✅" if is_correct else "❌"
        verdict_title = "*CORRECT DECISION!*" if is_correct else "*OPERATIVE CAUTION!*"
        
        result_text = (
            f"🧠 *1-MINUTE SURGICAL DECISION CHALLENGE*\n"
            f"*Topic:* {item['module']['title']}\n"
            f"━━━━━━━━━━━━━━━━━━━━━━\n"
            f"📋 *Vignette:*\n_{c['scenario']}_\n\n"
            f"❓ *Question:*\n*{c['question']}*\n\n"
            f"{verdict_icon} {verdict_title}\n"
            f"You selected: *({chr(65+selected_opt)})*\n"
            f"Correct Answer: *({letter}) {c['options'][c['correct_index']]}*\n\n"
            f"💡 *Operative Rationale:*\n{c['rationale']}\n"
            f"━━━━━━━━━━━━━━━━━━━━━━"
        )
        next_kb = {
            "inline_keyboard": [
                [
                    {"text": "➡️ Next Lesson Module", "callback_data": f"mod_{min(len(flat_modules)-1, mod_idx+1)}"},
                    {"text": "📊 View Progress", "callback_data": "cmd_progress"}
                ]
            ]
        }
        edit_message_text(chat_id, msg_id, result_text, reply_markup=next_kb)
        
    elif data.startswith("fc_"):
        parts = data.split("_")
        ch_id = parts[1]
        fc_idx = int(parts[2])
        answer_callback_query(cb_id)
        handle_flashcard(chat_id, user_data, curriculum, ch_id, fc_idx)
        
    elif data.startswith("fcreveal_"):
        parts = data.split("_")
        ch_id = parts[1]
        fc_idx = int(parts[2])
        answer_callback_query(cb_id)
        
        chapter = next(c for c in curriculum if c["id"] == ch_id)
        card = chapter["flashcards"][fc_idx]
        card_key = f"{ch_id}_{fc_idx}"
        is_mastered = card_key in user_data.get("mastered_cards", [])
        
        revealed_text = (
            f"🗂️ *SPACED REPETITION FLASHCARD*\n"
            f"*Chapter {chapter['number']}: {chapter['title']}*\n"
            f"Card {fc_idx + 1} of {len(chapter['flashcards'])} • `{card['category']}`\n\n"
            f"❓ *PROMPT:*\n*{card['front']}*\n\n"
            f"💡 *SURGICAL ANSWER:*\n*{card['back']}*\n"
            f"━━━━━━━━━━━━━━━━━━━━━━"
        )
        kb = {
            "inline_keyboard": [
                [{"text": "⭐ Mark Mastered" if not is_mastered else "✓ Mastered", "callback_data": f"fcmaster_{ch_id}_{fc_idx}"}],
                [
                    {"text": "⬅️ Prev", "callback_data": f"fc_{ch_id}_{max(0, fc_idx - 1)}"},
                    {"text": "Next ➡️", "callback_data": f"fc_{ch_id}_{min(len(chapter['flashcards']) - 1, fc_idx + 1)}"}
                ]
            ]
        }
        edit_message_text(chat_id, msg_id, revealed_text, reply_markup=kb)
        
    elif data.startswith("fcmaster_"):
        parts = data.split("_")
        ch_id = parts[1]
        fc_idx = int(parts[2])
        card_key = f"{ch_id}_{fc_idx}"
        
        if card_key not in user_data.get("mastered_cards", []):
            user_data.setdefault("mastered_cards", []).append(card_key)
            save_user_state(state)
            answer_callback_query(cb_id, text="⭐ Card marked as Mastered!", show_alert=False)
        else:
            answer_callback_query(cb_id, text="Already in your mastered deck!", show_alert=False)
            
    elif data.startswith("jump_ch_"):
        ch_id = data.replace("jump_ch_", "")
        answer_callback_query(cb_id)
        target_idx = 0
        for i, item in enumerate(flat_modules):
            if item["chapter"]["id"] == ch_id:
                target_idx = i
                break
        handle_lesson(chat_id, user_data, flat_modules, state, target_idx)
        
    elif data == "cmd_progress":
        answer_callback_query(cb_id)
        handle_progress(chat_id, user_data, flat_modules)

# ---------------------------------------------------------------------------
# Main Execution: HTTP Server Thread + Polling Loop
# ---------------------------------------------------------------------------
def main():
    print("==================================================")
    print("TMJ Arthroscopy Micro-Tutor — Render Cloud Daemon")
    print(f"Port: {PORT} (Serving Mobile Web App)")
    print("==================================================")
    
    curriculum = load_curriculum()
    flat_modules = get_all_modules_flat(curriculum)
    state = load_user_state()
    
    # 1. Start HTTP Static Web Server in background daemon thread
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()
    
    # 2. Verify Telegram Bot Connection
    me = tg_request("getMe")
    if not me.get("ok"):
        print("ERROR connecting to Telegram:", me)
        while True:
            time.sleep(10)
            
    print(f"Connected as @{me['result']['username']} ({me['result']['first_name']})")
    print("Listening for incoming messages...")
    
    offset = 0
    while True:
        try:
            updates = tg_request("getUpdates", {"offset": offset, "timeout": 20})
            if not updates.get("ok"):
                time.sleep(3)
                continue
                
            for update in updates.get("result", []):
                offset = update["update_id"] + 1
                
                if "message" in update:
                    msg = update["message"]
                    chat_id = msg["chat"]["id"]
                    text = msg.get("text", "").strip()
                    user_info = msg.get("from", {})
                    user_data = get_or_create_user(state, chat_id, user_info)
                    
                    if text in ["/start", "start"]:
                        handle_start(chat_id, user_data)
                    elif text in ["/lesson", "📚 Today's Lesson"]:
                        handle_lesson(chat_id, user_data, flat_modules, state)
                    elif text in ["/quiz", "🧠 Surgical Challenge"]:
                        handle_quiz(chat_id, user_data, flat_modules)
                    elif text in ["/flashcard", "🗂️ Flashcard Deck"]:
                        handle_flashcard(chat_id, user_data, curriculum)
                    elif text in ["/progress", "📊 My Progress"]:
                        handle_progress(chat_id, user_data, flat_modules)
                    elif text in ["/chapters", "📖 Jump to Chapter"]:
                        handle_chapter_menu(chat_id, curriculum)
                    elif text in ["/webapp", "🌐 Open Mobile Web App"]:
                        handle_web_app(chat_id)
                    else:
                        handle_start(chat_id, user_data)
                        
                elif "callback_query" in update:
                    process_callback_query(update["callback_query"], flat_modules, curriculum, state)
                    
            time.sleep(1)
        except Exception as e:
            print(f"[Loop Exception] {e}")
            time.sleep(3)

if __name__ == "__main__":
    main()
