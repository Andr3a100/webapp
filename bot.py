import html
import json
import os
from pathlib import Path
from telegram import (
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  KeyboardButton,
  ReplyKeyboardMarkup,
  Update,
  WebAppInfo,
)
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

def load_dotenv(path: str = ".env") -> None:
  env_path = Path(path)
  if not env_path.exists():
    return
  for line in env_path.read_text(encoding="utf-8").splitlines():
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
      continue
    key, value = stripped.split("=", 1)
    os.environ.setdefault(key.strip(), value.strip())


load_dotenv()

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
WEBAPP_URL = os.getenv("WEBAPP_URL")

if not TOKEN:
  raise SystemExit("Missing TELEGRAM_BOT_TOKEN env var (set it or add it to .env)")

if not WEBAPP_URL:
  raise SystemExit("Missing WEBAPP_URL env var (set it or add it to .env)")


def build_keyboard() -> ReplyKeyboardMarkup:
  webapp_button = KeyboardButton("Apri gestionale", web_app=WebAppInfo(url=WEBAPP_URL))
  return ReplyKeyboardMarkup([[webapp_button]], resize_keyboard=True)

def build_inline_keyboard() -> InlineKeyboardMarkup:
  webapp_button = InlineKeyboardButton("Apri gestionale", web_app=WebAppInfo(url=WEBAPP_URL))
  return InlineKeyboardMarkup([[webapp_button]])


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
  if not update.message:
    return
  await update.message.reply_text(
    "Ciao! Tocca il pulsante per aprire la WebApp della cooperativa.",
    reply_markup=build_keyboard(),
  )
  await update.message.reply_text(
    "Puoi aprire anche da qui:",
    reply_markup=build_inline_keyboard(),
  )


async def handle_web_app_data(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
  if not update.message or not update.message.web_app_data:
    return

  try:
    payload = json.loads(update.message.web_app_data.data)
  except json.JSONDecodeError:
    payload = {"raw": update.message.web_app_data.data}

  if payload.get("type") == "export":
    filename = payload.get("filename", "personale-cooperativa.csv")
    csv_data = payload.get("csv", "")
    if not csv_data:
      await update.message.reply_text("Export vuoto: nessun dato disponibile.")
      return
    from io import BytesIO
    file_bytes = BytesIO(csv_data.encode("utf-8"))
    file_bytes.name = filename
    await update.message.reply_document(
      document=file_bytes,
      filename=filename,
      caption="Export personale (CSV compatibile con Excel).",
    )
    return

  total = payload.get("total")
  staff = payload.get("staff", [])
  lines = ["Riepilogo ricevuto dalla WebApp:"]

  if isinstance(total, int):
    lines.append(f"Totale persone: {total}")

  if isinstance(staff, list) and staff:
    headers = ["Nome", "Ruolo", "Ore"]
    rows = []
    for person in staff:
      name = str(person.get("name", "-"))
      role = str(person.get("role", "-"))
      hours = str(person.get("hours", "-"))
      rows.append([name, role, hours])

    widths = [
      max(len(headers[0]), *(len(row[0]) for row in rows)),
      max(len(headers[1]), *(len(row[1]) for row in rows)),
      max(len(headers[2]), *(len(row[2]) for row in rows)),
    ]

    table_lines = [
      f"{headers[0].ljust(widths[0])}  {headers[1].ljust(widths[1])}  {headers[2].ljust(widths[2])}",
      f"{'-' * widths[0]}  {'-' * widths[1]}  {'-' * widths[2]}",
    ]
    for row in rows:
      table_lines.append(
        f"{row[0].ljust(widths[0])}  {row[1].ljust(widths[1])}  {row[2].ljust(widths[2])}"
      )

    table_text = html.escape("\n".join(table_lines))
    message = "\n".join(lines) + "\n<pre>" + table_text + "</pre>"
    await update.message.reply_text(message, parse_mode="HTML")
  else:
    await update.message.reply_text("\n".join(lines))


def main() -> None:
  app = Application.builder().token(TOKEN).build()
  app.add_handler(CommandHandler("start", start))
  app.add_handler(MessageHandler(filters.StatusUpdate.WEB_APP_DATA, handle_web_app_data))
  app.run_polling()


if __name__ == "__main__":
  main()
