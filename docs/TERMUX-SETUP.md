# Termux Android Setup Guide

## 1. Install Termux

Download from **F-Droid** (recommended) or GitHub Releases.
Do NOT download from Play Store (outdated).

- F-Droid: https://f-droid.org/packages/com.termux/
- GitHub: https://github.com/termux/termux-app/releases

## 2. Install Dependencies

Open Termux and run:

```sh
pkg update && pkg upgrade -y
pkg install -y nodejs git
```

## 3. Clone the Repository

```sh
cd ~
git clone <your-repo-url>
cd anri
```

Or if you already have the files, skip this step.

## 4. Install Node Modules

```sh
npm install
```

## 5. Configure Environment

```sh
cp .env.example .env
nano .env
```

Edit the values:

```
TOKEN=YOUR_BOT_TOKEN_HERE
CLIENTID=YOUR_BOT_ID_HERE
```

Save with `Ctrl+O`, `Enter`, then `Ctrl+X`.

## 6. Configure Custom Images (Optional)

Edit `src/config/config.json` to set custom banner/thumbnail images:

```sh
nano src/config/config.json
```

```json
{
    "color": "000000",
    "prefix": "?",
    "botName": "zar",
    "images": {
        "welcomeBanner": "https://your-image-url.com/banner.png",
        "welcomeThumbnail": "https://your-image-url.com/thumb.png",
        "panelBanner": "https://your-image-url.com/panel-banner.png",
        "panelThumbnail": "https://your-image-url.com/panel-thumb.png",
        "autoLoginBanner": "https://your-image-url.com/al-banner.png",
        "autoLoginThumbnail": "https://your-image-url.com/al-thumb.png"
    }
}
```

## 7. Run the Bot

```sh
npm start
```

Or directly:

```sh
node src/zar.js
```

## 8. Run in Background (Optional)

To keep the bot running after closing Termux:

### Option A: Using `tmux` (Recommended)

```sh
pkg install -y tmux
tmux new -s bot
npm start
```

Detach: `Ctrl+B`, then `D`
Reattach: `tmux attach -t bot`

### Option B: Using `nohup`

```sh
nohup npm start > bot.log 2>&1 &
```

View logs: `tail -f bot.log`
Stop: `pkill -f "node src/zar.js"`

## 9. Keep Termux Alive

Android may kill Termux in the background. Prevent this:

1. Open Termux
2. Swipe from left edge → tap **WAKELOCK**
3. This keeps the session alive even when screen is off

Alternatively, run:

```sh
termux-wake-lock
```

## 10. Auto-Start on Termux Launch (Optional)

Add this to your `~/.bashrc`:

```sh
echo 'cd ~/anri && npm start' >> ~/.bashrc
```

Now the bot starts automatically every time you open Termux.

## Troubleshooting

| Issue | Solution |
|---|---|
| `node: command not found` | Run `pkg install nodejs` |
| `npm install` fails | Run `pkg update && pkg upgrade` first |
| Bot crashes on start | Check `.env` token is correct |
| Termux gets killed by Android | Enable WAKELOCK (step 9) |
| `EACCES` permission errors | Run `chmod +x src/zar.js` |

## Quick Start (Copy-Paste All)

```sh
pkg update && pkg upgrade -y
pkg install -y nodejs git tmux
cd ~
git clone <your-repo-url>
cd anri
npm install
cp .env.example .env
nano .env
# Edit TOKEN and CLIENTID, then save
tmux new -s bot
npm start
# Detach with Ctrl+B then D
```
