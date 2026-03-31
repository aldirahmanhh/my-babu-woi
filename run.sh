#!/data/data/com.termux/files/usr/bin/bash

# ─── Termux Quick Setup ──────────────────────────────────────────────────────
# Run: bash run.sh

BOT_DIR="$HOME/anri"
SESSION="anri-bot"

cd "$BOT_DIR" 2>/dev/null || {
  echo "Bot not found at $BOT_DIR"
  echo ""
  echo "Clone your repo first:"
  echo "  git clone <repo-url> $BOT_DIR && cd $BOT_DIR"
  exit 1
}

# ── Menu ──────────────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════╗"
echo "║  Anri Bot - Termux Menu          ║"
echo "╠══════════════════════════════════╣"
echo "║  1. Setup (first time only)      ║"
echo "║  2. Start (background)           ║"
echo "║  3. Stop                         ║"
echo "║  4. View Logs                    ║"
echo "║  5. Update & Restart             ║"
echo "║  6. Exit                         ║"
echo "╚══════════════════════════════════╝"
echo ""
read -p "Choose [1-6]: " CHOICE

case "$CHOICE" in
  1)
    echo ""
    echo "[1/3] Installing dependencies..."
    pkg update -y > /dev/null 2>&1 && pkg install -y nodejs git tmux > /dev/null 2>&1
    echo "  ✓ Done"

    echo "[2/3] Installing node modules..."
    npm install --silent
    echo "  ✓ Done"

    if [ ! -f ".env" ]; then
      echo "[3/3] Setting up .env..."
      cp .env.example .env 2>/dev/null || echo "TOKEN=" > .env
      echo ""
      echo "  Edit .env with your bot token:"
      echo "    nano .env"
      echo ""
      read -p "  Open .env now? (y/n): " EDIT
      [ "$EDIT" = "y" ] && nano .env
    else
      echo "[3/3] .env already exists ✓"
    fi
    echo ""
    echo "Setup done! Run this script again and choose 2 to start."
    ;;

  2)
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      echo "Bot already running. Attach to it:"
      echo "  tmux attach -t $SESSION"
    else
      echo "Starting bot..."
      termux-wake-lock 2>/dev/null
      tmux new-session -d -s "$SESSION" "cd $BOT_DIR && npm start"
      echo "✓ Bot started in background"
      echo "  Logs:  tmux attach -t $SESSION"
      echo "  Stop:  Choose option 3"
    fi
    ;;

  3)
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      tmux kill-session -t "$SESSION"
      echo "✓ Bot stopped"
    else
      echo "Bot is not running"
    fi
    ;;

  4)
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      tmux attach -t "$SESSION"
    else
      echo "Bot is not running. Start it first (option 2)."
    fi
    ;;

  5)
    echo "Pulling latest changes..."
    git pull 2>&1 || echo "! Git pull failed"
    echo "Restarting bot..."
    tmux kill-session -t "$SESSION" 2>/dev/null
    sleep 1
    termux-wake-lock 2>/dev/null
    tmux new-session -d -s "$SESSION" "cd $BOT_DIR && npm start"
    echo "✓ Bot updated and restarted"
    ;;

  6)
    echo "Bye!"
    ;;

  *)
    echo "Invalid choice"
    ;;
esac
