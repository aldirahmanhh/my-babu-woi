import threading
import time
import json
import logging
import websocket
import requests
import random
import os
import sys
import signal

logger = logging.getLogger(__name__)

class AutoLoginWorker:
    def __init__(self, user_id, token, callback_update_status=None, channel_id_to_watch=None):
        self.user_id = str(user_id)
        self.token = self.normalize_token(token)
        self.callback_update_status = callback_update_status
        self.ws = None
        self.thread = None
        self.running = False
        self.session_id = None
        self.discord_user_id = None
        self.cached_guild_id = None
        self.headers = {
            "Authorization": self.token,
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        self.channel_id_to_watch = channel_id_to_watch or "1243177096948486186"
        self.logs = [] # Initialize log list

    def add_log(self, message):
        """Adds a log entry and updates status if callback is set."""
        timestamp = time.strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {message}"
        self.logs.append(log_entry)
        # Keep only last 10 logs
        if len(self.logs) > 10:
            self.logs.pop(0)
        
        logger.info(f"[AutoLogin-{self.user_id}] {message}")
        
        # If callback exists, send status update (optional, or just rely on panel refresh)
        # We don't want to spam the callback for every log, but maybe for important ones?
        pass

    def normalize_token(self, token):
        if not token:
            return ""
        s = token.strip().strip('"\'')
        return s

    def verify_token(self):
        # 1. Try "Authorization: Token" (Raw user token)
        self.headers["Authorization"] = self.token
        try:
            r = requests.get("https://discord.com/api/v9/users/@me", headers=self.headers)
            if r.status_code == 200:
                data = r.json()
                self.discord_user_id = data['id']
                self.add_log(f"✅ User Token Verified: {data['username']}")
                return True
        except Exception as e:
            pass # Continue to next method

        # 2. Try "Authorization: Bot Token"
        try:
            bot_token = f"Bot {self.token}"
            self.headers["Authorization"] = bot_token
            r = requests.get("https://discord.com/api/v9/users/@me", headers=self.headers)
            if r.status_code == 200:
                data = r.json()
                self.discord_user_id = data['id']
                self.token = bot_token # Update stored token
                self.add_log(f"✅ Bot Token Verified: {data['username']}")
                return True
        except Exception as e:
            pass

        # 3. Try "Authorization: Bearer Token"
        try:
            bearer_token = f"Bearer {self.token.replace('Bot ', '')}"
            self.headers["Authorization"] = bearer_token
            r = requests.get("https://discord.com/api/v9/users/@me", headers=self.headers)
            if r.status_code == 200:
                data = r.json()
                self.discord_user_id = data['id']
                self.token = bearer_token # Update stored token
                self.add_log(f"✅ Bearer Token Verified: {data['username']}")
                return True
        except Exception as e:
            pass

        # If all failed, log the last status (or generic error)
        self.add_log(f"❌ Verification Failed. Last Status: {r.status_code if 'r' in locals() else 'Unknown'}")
        return False

    def start(self):
        if self.running:
            self.add_log("⚠️ Already running")
            return
        
        # Verify token first
        if not self.verify_token():
            if self.callback_update_status:
                self.callback_update_status(self.user_id, "❌ Token Invalid")
            return

        # Re-initialize headers in case token changed
        self.headers["Authorization"] = self.token
        
        self.running = True
        self.thread = threading.Thread(target=self._run_ws, daemon=True)
        self.thread.start()
        self.add_log("🟢 Worker Started")
        if self.callback_update_status:
            self.callback_update_status(self.user_id, "🟢 Running")

    def stop(self):
        self.running = False
        if self.ws:
            self.ws.close()
        self.add_log("🔴 Worker Stopped")
        if self.callback_update_status:
            self.callback_update_status(self.user_id, "🔴 Stopped")

    def _run_ws(self):
        # websocket.enableTrace(True)
        self.ws = websocket.WebSocketApp(
            "wss://gateway.discord.gg/?v=9&encoding=json",
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close
        )
        while self.running:
            self.ws.run_forever()
            if self.running:
                self.add_log("🔄 Reconnecting in 5s...")
                time.sleep(5)

    def on_open(self, ws):
        self.add_log("📡 Connected to Gateway")

    def on_close(self, ws, close_status_code, close_msg):
        self.add_log(f"🔌 Gateway Closed. Code: {close_status_code}")

    def on_error(self, ws, error):
        self.add_log(f"❌ WebSocket Error: {error}")

    def on_message(self, ws, message):
        if not self.running:
            return
            
        try:
            data = json.loads(message)
            op = data.get("op")
            t = data.get("t")
            d = data.get("d")

            if op == 10: # Hello
                heartbeat_interval = d["heartbeat_interval"] / 1000
                threading.Thread(target=self.send_heartbeat, args=(ws, heartbeat_interval), daemon=True).start()
                
                identify_payload = {
                    "op": 2,
                    "d": {
                        "token": self.token,
                        "capabilities": 16381,
                        "properties": {
                            "os": "Windows",
                            "browser": "Chrome",
                            "device": "",
                            "system_locale": "en-US",
                            "browser_user_agent": self.headers["User-Agent"],
                            "browser_version": "120.0.0.0",
                            "os_version": "10",
                            "referrer": "",
                            "referring_domain": "",
                            "referrer_current": "",
                            "referring_domain_current": "",
                            "release_channel": "stable",
                            "client_build_number": 263509,
                            "client_event_source": None
                        },
                        "presence": {
                            "status": "online",
                            "since": 0,
                            "activities": [],
                            "afk": False
                        },
                        "compress": False,
                        "client_state": {
                            "guild_versions": {},
                            "highest_last_message_id": "0",
                            "read_state_version": 0,
                            "user_guild_settings_version": -1,
                            "user_settings_version": -1,
                            "private_channels_version": 0,
                            "api_code_version": 0
                        }
                    }
                }
                ws.send(json.dumps(identify_payload))

            elif t == "READY":
                self.session_id = d["session_id"]
                logger.info(f"[AutoLogin-{self.user_id}] Ready! Session ID: {self.session_id}")

            elif t == "MESSAGE_CREATE":
                self.handle_message(d)

        except Exception as e:
            logger.error(f"[AutoLogin-{self.user_id}] Message error: {e}")

    def send_heartbeat(self, ws, interval):
        while self.running and ws.sock and ws.sock.connected:
            time.sleep(interval)
            payload = {"op": 1, "d": None}
            try:
                ws.send(json.dumps(payload))
            except Exception:
                break

    def handle_message(self, d):
        msg_channel_id = d.get("channel_id")
        if msg_channel_id != self.channel_id_to_watch:
            return

        guild_id = d.get("guild_id")
        if guild_id:
            self.cached_guild_id = guild_id

        msg_id = d.get("id")
        author = d.get("author", {})
        mentions = d.get("mentions", [])
        components = d.get("components", [])
        flags = d.get("flags", 0)
        
        is_ephemeral = (flags & 64) == 64
        
        mentioned = False
        for user in mentions:
            if user.get("id") == self.discord_user_id:
                mentioned = True
                break
        
        if mentioned or is_ephemeral:
            if components:
                for row in components:
                    for component in row.get("components", []):
                        if component.get("type") == 2: # Button
                            label = component.get("label")
                            custom_id = component.get("custom_id")
                            
                            if label == "Authenticate":
                                # Random delay before clicking
                                delay = random.uniform(1.5, 4.5)
                                self.add_log(f"⏳ Waiting {delay:.2f}s (Anti-RateLimit)")
                                time.sleep(delay)

                                self.add_log("🖱️ Clicking 'Authenticate'...")
                                app_id = author.get("id")
                                self.click_button(d.get("guild_id"), msg_channel_id, msg_id, app_id, custom_id, flags)
                                if self.callback_update_status:
                                    self.callback_update_status(self.user_id, "🔄 Authenticating...")
                                
                            elif label == "Yes, Log Me In":
                                # Random delay before clicking
                                delay = random.uniform(1.0, 3.0)
                                self.add_log(f"⏳ Waiting {delay:.2f}s (Anti-RateLimit)")
                                time.sleep(delay)

                                self.add_log("🖱️ Clicking 'Yes, Log Me In'...")
                                app_id = author.get("id")
                                current_guild_id = d.get("guild_id")
                                self.click_button(current_guild_id, msg_channel_id, msg_id, app_id, custom_id, flags)
                                if self.callback_update_status:
                                    self.callback_update_status(self.user_id, "✅ Logged In")

    def click_button(self, guild_id, channel_id, message_id, application_id, custom_id, message_flags=0):
        if not self.session_id:
            return
        
        if not guild_id and self.cached_guild_id:
            guild_id = self.cached_guild_id

        url = "https://discord.com/api/v9/interactions"
        nonce = str(int(time.time() * 1000000))
        
        payload = {
            "type": 3,
            "nonce": nonce,
            "guild_id": guild_id,
            "channel_id": channel_id,
            "message_id": message_id,
            "application_id": application_id,
            "data": {
                "component_type": 2,
                "custom_id": custom_id
            },
            "session_id": self.session_id
        }

        if message_flags & 64:
            payload["message_flags"] = 64
        
        try:
            r = requests.post(url, headers=self.headers, json=payload)
            if r.status_code == 204:
                self.add_log(f"✅ Click Success: {custom_id}")
            elif r.status_code == 429:
                retry_after = r.json().get('retry_after', 2)
                self.add_log(f"⚠️ Rate Limited. Waiting {retry_after}s...")
                time.sleep(retry_after)
            else:
                self.add_log(f"❌ Click Failed: {r.status_code}")
        except Exception as e:
            self.add_log(f"❌ Click Error: {e}")

if __name__ == "__main__":
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    
    token = os.getenv("DISCORD_TOKEN")
    channel_id = os.getenv("CHANNEL_ID") or "1243177096948486186"
    
    if not token:
        print("\n=== Discord Auto Login Bot ===")
        print("Tip: You can set DISCORD_TOKEN env variable to skip this step.")
        token = input("Enter your User Token: ").strip()
    
    # Create worker
    bot = AutoLoginWorker(user_id="standalone", token=token, channel_id_to_watch=channel_id)
    
    # Register signal handlers for graceful shutdown
    def signal_handler(sig, frame):
        print("\nStopping bot...")
        bot.stop()
        sys.exit(0)
        
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    print(f"Starting bot for channel {channel_id}...")
    bot.start()
    
    # Keep main thread alive
    while True:
        time.sleep(1)
