#!/data/data/com.termux/files/usr/bin/bash

# ─── Termux Auto-Setup Script ────────────────────────────────────────────────
# Run: bash setup-termux.sh

set -e

BOT_DIR="$HOME/anri"

echo "╔══════════════════════════════════════════╗"
echo "║  Discord Bot - Termux Setup Script       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Step 1: Update & Install Dependencies ─────────────────────────────────────
echo "[1/5] Updating packages..."
pkg update -y && pkg upgrade -y > /dev/null 2>&1

echo "[2/5] Installing dependencies (nodejs, git, tmux)..."
pkg install -y nodejs git tmux > /dev/null 2>&1
echo "  ✓ nodejs: $(node --version)"
echo "  ✓ npm:    $(npm --version)"
echo "  ✓ tmux:   $(tmux -V)"
echo ""

# ── Step 2: Clone or Pull Repository ──────────────────────────────────────────
echo "[3/5] Checking repository..."
if [ -d "$BOT_DIR" ]; then
    echo "  Directory exists. Pulling latest changes..."
    cd "$BOT_DIR"
    git pull 2>/dev/null || echo "  ! Not a git repo, skipping pull."
else
    echo "  Directory not found. Please clone your repo manually:"
    echo "    git clone <your-repo-url> $BOT_DIR"
    echo ""
    read -p "  Or enter repo URL now (leave empty to skip): " REPO_URL
    if [ -n "$REPO_URL" ]; then
        git clone "$REPO_URL" "$BOT_DIR"
        cd "$BOT_DIR"
    else
        echo "  Skipping clone. Make sure your files are in $BOT_DIR"
        cd "$BOT_DIR" 2>/dev/null || { echo "  ✗ Directory not found. Exiting."; exit 1; }
    fi
fi
echo ""

# ── Step 3: Install Node Modules ──────────────────────────────────────────────
echo "[4/5] Installing node modules..."
npm install --silent
echo "  ✓ Dependencies installed"
echo ""

# ── Step 4: Setup .env ────────────────────────────────────────────────────────
echo "[5/5] Checking .env file..."
if [ ! -f ".env" ]; then
    echo "  .env not found. Creating from .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo ""
        echo "  ┌─────────────────────────────────────────────┐"
        echo "  │  Please edit .env with your bot credentials │"
        echo "  │  Run: nano .env                              │"
        echo "  │                                              │"
        echo "  │  TOKEN=YOUR_BOT_TOKEN                        │"
        echo "  │  CLIENTID=YOUR_BOT_ID                        │"
        echo "  └─────────────────────────────────────────────┘"
        echo ""
        read -p "  Open .env now? (y/n): " EDIT_ENV
        if [ "$EDIT_ENV" = "y" ] || [ "$EDIT_ENV" = "Y" ]; then
            nano .env
        fi
    else
        echo "  ✗ .env.example not found. Create .env manually:"
        echo "    echo 'TOKEN=YOUR_TOKEN' > .env"
        echo "    echo 'CLIENTID=YOUR_ID' >> .env"
    fi
else
    echo "  ✓ .env already exists"
fi
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════╗"
echo "║  Setup Complete!                         ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "To start the bot:"
echo "  npm start"
echo ""
echo "To run in background with tmux:"
echo "  tmux new -s bot"
echo "  npm start"
echo "  (Detach: Ctrl+B then D)"
echo "  (Reattach: tmux attach -t bot)"
echo ""
echo "To keep Termux alive:"
echo "  termux-wake-lock"
echo ""
