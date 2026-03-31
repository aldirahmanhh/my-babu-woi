#!/data/data/com.termux/files/usr/bin/bash

# ─── Termux Bot Runner ───────────────────────────────────────────────────────
# Usage:
#   bash start-bot.sh          # Run in foreground
#   bash start-bot.sh bg       # Run in background (tmux) with auto-update
#   bash start-bot.sh restart  # Restart background bot (pull + start)
#   bash start-bot.sh stop     # Stop background bot

BOT_DIR="$HOME/anri"
SESSION_NAME="discord-bot"

cd "$BOT_DIR" || { echo "✗ Bot directory not found: $BOT_DIR"; exit 1; }

case "$1" in
    bg|restart)
        # Stop existing session if any
        if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
            echo "Stopping existing bot session..."
            tmux kill-session -t "$SESSION_NAME"
            sleep 1
        fi

        if [ "$1" = "restart" ]; then
            echo "Pulling latest changes..."
            git pull 2>&1 || echo "! Git pull failed, continuing with current code..."
        fi

        echo "Starting bot in background (tmux session: $SESSION_NAME)..."
        termux-wake-lock 2>/dev/null
        tmux new-session -d -s "$SESSION_NAME" "cd $BOT_DIR && npm start"
        echo "✓ Bot started in background"
        echo "  View logs:  tmux attach -t $SESSION_NAME"
        echo "  Detach:     Ctrl+B then D"
        echo "  Stop:       bash start-bot.sh stop"
        ;;
    stop)
        if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
            tmux kill-session -t "$SESSION_NAME"
            echo "✓ Bot stopped"
        else
            echo "✗ No running bot session found"
        fi
        ;;
    *)
        echo "╔══════════════════════════════════════╗"
        echo "║  Discord Bot - Starting...           ║"
        echo "╚══════════════════════════════════════╝"
        npm start
        ;;
esac
