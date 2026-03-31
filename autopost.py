from flask import Flask, render_template_string, request, redirect, flash, jsonify
import json, time, threading, os, requests

app = Flask(__name__)
app.secret_key = 'supersecretkey'  # Diperlukan untuk flash messages
CONFIG_PATH = "config.json"

# Struktur konfigurasi baru untuk mendukung multiple token
config = {
    "tokens": [], # Daftar token, setiap elemen adalah dict konfigurasi token
    "current_token_index": -1, # Index token yang sedang aktif
    "dark_mode": False
}
config_loaded = False
# Status posting akan disimpan per token di dalam config['tokens'][index]
# Contoh: token_data['posting_active']

def load_config():
    global config, config_loaded
    if config_loaded:
        return
    
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r") as f:
            try:
                # Muat konfigurasi
                loaded_config = json.load(f)
                
                # Cek apakah ini struktur lama (hanya satu token)
                if 'token' in loaded_config and 'channels' in loaded_config:
                    # Konversi dari struktur lama ke struktur baru
                    print("[INFO] Mengkonversi config lama ke struktur multi-token.")
                    new_token = {
                        "name": "Default Bot Token", # Beri nama default
                        "token": loaded_config.get("token", ""),
                        "use_webhook": loaded_config.get("use_webhook", False),
                        "webhook_url": loaded_config.get("webhook_url", ""),
                        "channels": loaded_config.get("channels", []),
                        "posting_active": False # Status awal posting
                    }
                    config["tokens"].append(new_token)
                    config["current_token_index"] = 0
                    config["dark_mode"] = loaded_config.get("dark_mode", False)
                    save_config() # Simpan dengan struktur baru
                else:
                    # Muat struktur baru
                    config.update(loaded_config)
                    # Pastikan current_token_index valid
                    if not (0 <= config["current_token_index"] < len(config["tokens"])):
                        config["current_token_index"] = 0 if config["tokens"] else -1
            except json.JSONDecodeError:
                print("[ERROR] config.json tidak valid, memuat default.")
    
    # Inisialisasi token jika masih kosong
    if not config["tokens"]:
        config["current_token_index"] = -1
        
    config_loaded = True

def save_config():
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=4)

def get_current_token_data():
    load_config()
    if 0 <= config["current_token_index"] < len(config["tokens"]):
        return config["tokens"][config["current_token_index"]]
    return None

def send_log(message, channel_id=None, success=True, webhook_url=None):
    if webhook_url:
        try:
            now = time.strftime("%d %B %Y  %I:%M:%S %p")
            embed = {
                "title": "<a:ms_discord:1129069176917610619> Auto Post Discord <a:ms_discord:1129069176917610619>",
                "description": "> **Details Info**",
                "color": 65280 if success else 16711680,
                "fields": [
                    {"name": "<a:live:1247888274161143878> Status Log", "value": "> Success" if success else "> Failed"},
                    {"name": "<:BS_Time:1182386606661972099> Date Time", "value": f"> {now}"},
                    {"name": "<:discord:1263889532688797727> Channel Target", "value": f"> <#{channel_id}>" if channel_id else "> Unknown"},
                    {"name": "<a:ki_verify:1193420850511224913> Status Message", "value": f"> {message}"}
                ],
                "footer": {"text": "Auto Post By Lantas Continental. design By Void_String"}
            }
            payload = {"embeds": [embed]}
            requests.post(webhook_url, json=payload)
        except Exception as e:
            print(f"[LOG ERROR] {e}")

# --- Threading Management ---
# Dictionary untuk menyimpan thread posting per token (menggunakan nama token sebagai kunci)
posting_threads = {}

def post_to_channel(token_data, ch):
    token_name = token_data['name']
    
    # Menggunakan loop 'while' dan cek status aktif dari config saat ini
    while token_data.get("posting_active", False):
        try:
            url = f"https://discord.com/api/v10/channels/{ch['id']}/messages"
            headers = {"Authorization": token_data["token"], "Content-Type": "application/json"}
            data = {"content": ch["message"]}
            res = requests.post(url, headers=headers, json=data)
            success = res.status_code in (200, 204)
            
            # Kirim log jika webhook diaktifkan
            if token_data.get("use_webhook") and token_data.get("webhook_url"):
                send_log(
                    f"Pesan ke <#{ch['id']}> {'berhasil' if success else 'gagal'} [{res.status_code}].", 
                    ch['id'], 
                    success, 
                    token_data["webhook_url"]
                )
        except Exception as e:
            if token_data.get("use_webhook") and token_data.get("webhook_url"):
                send_log(
                    f"Error kirim ke <#{ch['id']}>: {e}", 
                    ch['id'], 
                    False, 
                    token_data["webhook_url"]
                )
        
        # Cek ulang status posting sebelum tidur
        if not token_data.get("posting_active", False):
             break
             
        time.sleep(ch["interval"])
        
    print(f"[INFO] Thread posting untuk channel {ch['id']} ({token_name}) dihentikan.")

def auto_post(token_data):
    token_name = token_data['name']
    
    # Hapus thread lama (jika ada) dan mulai thread baru
    if token_name in posting_threads:
        # Hentikan thread lama secara 'soft' (dengan mengubah posting_active menjadi False)
        # Catatan: Ini tidak langsung menghentikan thread, hanya memicu kondisi keluar pada loop 'while' di post_to_channel
        # Kami mengandalkan daemon=True untuk thread ini
        del posting_threads[token_name]
    
    # Buat dictionary untuk menyimpan sub-thread per channel
    channel_threads = {} 
    
    for ch in token_data["channels"]:
        thread_name = f"poster-{token_name}-{ch['id']}"
        t = threading.Thread(target=post_to_channel, args=(token_data, ch,), name=thread_name, daemon=True)
        channel_threads[ch['id']] = t
        t.start()
        
    # Simpan sub-thread ke dictionary global
    posting_threads[token_name] = channel_threads
    print(f"[INFO] Auto posting untuk '{token_name}' dimulai dengan {len(token_data['channels'])} channel.")


# --- Routing dan Logic ---

@app.route("/", methods=["GET"])
@app.route("/index", methods=["GET"])
def index():
    load_config()
    
    # Periksa ketersediaan token
    if not config["tokens"] or config["current_token_index"] == -1:
        return redirect("/add-new-token")
        
    current_token_data = get_current_token_data()
    
    # Jika token ditemukan, tampilkan halaman utama
    return render_template_string(
        html_template, 
        config_json=json.dumps(current_token_data, indent=4), 
        config=config, 
        current_token_data=current_token_data,
        editing=False,
        sidebar_hidden=request.cookies.get('sidebar_hidden', 'false') == 'true'
    )

@app.route("/add-new-token", methods=["GET"])
def add_new_token_page():
    load_config()
    # Halaman untuk menambahkan token baru (seperti halaman login)
    return render_template_string(
        register_token_template,
        has_existing_tokens=len(config["tokens"]) > 0
    )

@app.route("/register-token", methods=["POST"])
def register_token():
    global config
    token_name = request.form.get("token_name", "").strip()
    token_value = request.form.get("token", "").strip()
    
    if not token_name or not token_value:
        flash("Nama Bot dan Token Discord diperlukan.", "danger")
        return redirect("/add-new-token")
        
    # Cek duplikasi token
    if any(t['token'] == token_value for t in config["tokens"]):
        flash("Token ini sudah terdaftar. Silakan gunakan tombol Switch Token di sidebar.", "warning")
        return redirect("/add-new-token")

    # Cek duplikasi nama (opsional, tapi baik untuk UX)
    if any(t['name'] == token_name for t in config["tokens"]):
        token_name += f" ({len(config['tokens']) + 1})" # Tambahkan suffix jika nama duplikat

    new_token_data = {
        "name": token_name,
        "token": token_value,
        "use_webhook": False,
        "webhook_url": "",
        "channels": [],
        "posting_active": False
    }
    
    config["tokens"].append(new_token_data)
    
    # Otomatis beralih ke token baru (index terakhir)
    config["current_token_index"] = len(config["tokens"]) - 1
    
    save_config()
    flash(f"Token '{token_name}' berhasil ditambahkan dan diaktifkan.", "success")
    return redirect("/")

@app.route("/switch-token/<int:index>", methods=["GET"])
def switch_token(index):
    global config
    load_config()
    
    if 0 <= index < len(config["tokens"]):
        config["current_token_index"] = index
        save_config()
        flash(f"Beralih ke token: {config['tokens'][index]['name']}", "info")
    else:
        flash("Index token tidak valid.", "danger")
        
    return redirect("/")

@app.route("/save-config", methods=["POST"])
def save():
    load_config()
    current_token_data = get_current_token_data()
    if not current_token_data:
        flash("Token tidak ditemukan atau belum dipilih.", "danger")
        return redirect("/add-new-token")
    
    # Menangani pengaturan webhook secara terpisah
    if 'webhook_url' in request.form:
        webhook_url = request.form.get("webhook_url", "").strip()
        use_webhook = True if request.form.get("use_webhook") else False
        current_token_data["webhook_url"] = webhook_url
        current_token_data["use_webhook"] = use_webhook
        save_config()
        flash("Webhook settings saved successfully!", "success")
        return redirect("/#webhook")
    
    # Menangani token secara terpisah
    if 'token' in request.form:
        token = request.form.get("token", "").strip()
        if token:
            # Periksa jika token berubah, apakah token baru sudah terdaftar di token lain
            if token != current_token_data["token"]:
                if any(t['token'] == token and t['name'] != current_token_data['name'] for t in config["tokens"]):
                    flash("Token ini sudah digunakan oleh bot lain. Silakan switch token.", "danger")
                    return redirect("/#settings")
            
            current_token_data["token"] = token
            save_config()
            flash("Token saved successfully!", "success")
        return redirect("/#settings")
    
    # Menangani operasi channel
    channel_id = request.form.get("channel_id")
    message = request.form.get("message")
    original_channel_id = request.form.get("original_channel_id")
    action = request.form.get("action")
    
    # Validasi input
    if action != "remove" and (not channel_id or not message):
        flash("All fields are required: Channel ID, Message", "danger")
        return redirect("/#channels")

    
    try:
        hours = int(request.form.get("hours", 0))
        minutes = int(request.form.get("minutes", 0))
        seconds = int(request.form.get("seconds", 0))
    except ValueError:
        hours = minutes = seconds = 0
    
    interval = hours * 3600 + minutes * 60 + seconds
    
    # Validasi interval minimal 1 detik
    if action != "remove" and interval <= 0:
        flash("Interval must be at least 1 second", "danger")
        return redirect("/#channels")
    
    # Cek duplikasi channel ID untuk operasi tambah
    if action == "add":
        if any(ch['id'] == channel_id for ch in current_token_data["channels"]):
            flash(f"Channel ID {channel_id} already exists!", "danger")
            return redirect("/#channels")
    
    # Eksekusi operasi
    if action == "add":
        current_token_data["channels"].append({"id": channel_id, "message": message, "interval": interval})
        flash("Channel added successfully!", "success")
    elif action == "edit":
        found = False
        for ch in current_token_data["channels"]:
            # Cek apakah mengedit channel dengan ID yang berbeda
            if ch["id"] == original_channel_id:
                # Jika ID berubah, cek apakah ID baru sudah ada
                if channel_id != original_channel_id and any(c['id'] == channel_id for c in current_token_data["channels"]):
                    flash(f"Channel ID {channel_id} already exists!", "danger")
                    return redirect("/#channels")
                
                ch["id"] = channel_id
                ch["message"] = message
                ch["interval"] = interval
                found = True
                break
        
        if found:
            flash("Channel updated successfully!", "success")
        else:
            flash("Channel not found!", "danger")
    elif action == "remove":
        before_count = len(current_token_data["channels"])
        current_token_data["channels"] = [ch for ch in current_token_data["channels"] if ch["id"] != channel_id]
        after_count = len(current_token_data["channels"])
        
        if after_count < before_count:
            flash("Channel removed successfully!", "success")
        else:
            flash("Channel not found!", "danger")
    
    save_config()
    return redirect("/#channels")

@app.route("/start", methods=["POST"])
def start():
    load_config()
    current_token_data = get_current_token_data()
    
    if not current_token_data:
        flash("Token tidak ditemukan.", "danger")
        return redirect("/")

    if not current_token_data.get("posting_active", False):
        current_token_data["posting_active"] = True
        
        # Mulai thread posting
        # Catatan: Karena thread yang dibuat adalah daemon, kita tidak perlu secara eksplisit mengelola `posting_active` global.
        # Status aktif/non-aktif sekarang dikelola di dalam `token_data`.
        threading.Thread(target=auto_post, args=(current_token_data,), daemon=True).start()
        
        save_config()
        flash(f"Auto posting untuk '{current_token_data['name']}' dimulai!", "success")
    return redirect("/")

@app.route("/stop", methods=["POST"])
def stop():
    load_config()
    current_token_data = get_current_token_data()
    
    if not current_token_data:
        flash("Token tidak ditemukan.", "danger")
        return redirect("/")
        
    current_token_data["posting_active"] = False
    
    # Status akan diperbarui dalam loop thread `post_to_channel`, 
    # yang kemudian akan menghentikan dirinya sendiri secara 'soft'.
    
    save_config()
    flash(f"Auto posting untuk '{current_token_data['name']}' dihentikan.", "info")
    return redirect("/")

@app.route("/test-webhook", methods=["POST"])
def test_webhook():
    load_config()
    current_token_data = get_current_token_data()
    
    if not current_token_data or not current_token_data.get("use_webhook") or not current_token_data.get("webhook_url"):
        flash("Webhook tidak diaktifkan atau URL tidak ada.", "danger")
        return redirect("/#webhook")
        
    send_log(
        f"Test webhook log berhasil dikirim dari bot '{current_token_data['name']}'.", 
        success=True, 
        webhook_url=current_token_data["webhook_url"]
    )
    flash("Webhook test sent successfully!", "success")
    return redirect("/#webhook")

@app.route("/save-dark-mode", methods=["POST"])
def save_dark_mode():
    global config
    config['dark_mode'] = request.json.get('dark_mode', False)
    save_config()
    return jsonify(success=True)

# Route untuk edit channel
@app.route("/edit-channel", methods=["GET"])
def edit_channel():
    load_config()
    current_token_data = get_current_token_data()
    
    if not current_token_data:
        flash("Token tidak ditemukan.", "danger")
        return redirect("/")
        
    channel_id = request.args.get("channel_id")
    message = request.args.get("message", "")
    hours = request.args.get("hours", 0)
    minutes = request.args.get("minutes", 0)
    seconds = request.args.get("seconds", 0)
    
    return render_template_string(
        html_template,
        config_json=json.dumps(current_token_data, indent=4),
        config=config,
        current_token_data=current_token_data,
        editing=True,
        original_channel_id=channel_id,
        channel_id=channel_id,
        channel_message=message,
        hours=hours,
        minutes=minutes,
        seconds=seconds,
        sidebar_hidden=request.cookies.get('sidebar_hidden', 'false') == 'true'
    )

# --- Template HTML untuk Halaman Pendaftaran Token ---
register_token_template = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Register New Token</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet">
    <style>
        body {
            background-color: #f0f2f5;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .register-card {
            width: 100%;
            max-width: 400px;
            padding: 30px;
            border-radius: 15px;
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
            background-color: white;
        }
        .header-icon {
            font-size: 3rem;
            color: #4361ee;
            margin-bottom: 15px;
        }
        .btn-primary {
            background: linear-gradient(135deg, #4361ee, #3f37c9);
            border: none;
        }
        .alert-flash {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 2000;
            min-width: 300px;
        }
    </style>
</head>
<body>
    {% with messages = get_flashed_messages(with_categories=true) %}
        {% if messages %}
            <div class="alert-flash">
                {% for category, message in messages %}
                    <div class="alert alert-{{ category }} alert-dismissible fade show" role="alert">
                        {{ message }}
                        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                    </div>
                {% endfor %}
            </div>
        {% endif %}
    {% endwith %}

    <div class="register-card">
        <div class="text-center">
            <i class="bi bi-robot header-icon"></i>
            <h4 class="mb-4">Add New Discord Bot Token</h4>
        </div>
        <form method="post" action="/register-token">
            <div class="mb-3">
                <label for="tokenName" class="form-label">Bot Name</label>
                <input type="text" name="token_name" class="form-control" id="tokenName" placeholder="e.g., Main Bot Token" required>
            </div>
            <div class="mb-3">
                <label for="botToken" class="form-label">Discord Bot Token</label>
                <input type="password" name="token" class="form-control" id="botToken" placeholder="Enter your Bot Token" required>
            </div>
            <button type="submit" class="btn btn-primary w-100 mt-2"><i class="bi bi-plus-circle"></i> Register Token</button>
            {% if has_existing_tokens %}
            <div class="text-center mt-3">
                <a href="/" class="btn btn-secondary btn-sm">Go to Active Token</a>
            </div>
            {% endif %}
        </form>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script>
        // Auto-dismiss alerts after 5 seconds
        setTimeout(() => {
            document.querySelectorAll('.alert').forEach(alert => {
                new bootstrap.Alert(alert).close();
            });
        }, 5000);
    </script>
</body>
</html>
'''

# --- Template HTML Utama yang Diubah ---
html_template = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Auto Post - {{ current_token_data.name }}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root {
            --primary: #4361ee;
            --primary-dark: #3a56d4;
            --secondary: #7209b7;
            --success: #4cc9f0;
            --danger: #e63946;
            --warning: #f4a261;
            --dark: #1a1a2e;
            --dark-card: #16213e;
            --dark-surface: #0f3460;
            --light: #f8f9fa;
            --gray: #6c757d;
            --gray-light: #e9ecef;
        }

        [data-theme="dark"] {
            --bg-primary: var(--dark);
            --bg-secondary: var(--dark-card);
            --bg-surface: var(--dark-surface);
            --text-primary: #ffffff;
            --text-secondary: #b0b7c3;
            --border-color: #2d3748;
        }

        [data-theme="light"] {
            --bg-primary: #ffffff;
            --bg-secondary: var(--gray-light);
            --bg-surface: #ffffff;
            --text-primary: #212529;
            --text-secondary: var(--gray);
            --border-color: #dee2e6;
        }

        body {
            background-color: var(--bg-primary);
            color: var(--text-primary);
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            transition: background-color 0.3s ease, color 0.3s ease;
            min-height: 100vh;
            margin: 0;
            padding: 0;
        }

        /* Sidebar Improvements */
        .sidebar {
            width: 280px;
            background: var(--bg-secondary);
            border-right: 1px solid var(--border-color);
            height: 100vh;
            position: fixed;
            left: 0;
            top: 0;
            z-index: 1000;
            transition: transform 0.3s ease;
            overflow-y: auto;
        }

        @media (max-width: 768px) {
            .sidebar {
                transform: translateX(-100%);
            }
            .sidebar-open .sidebar {
                transform: translateX(0);
            }
        }

        .sidebar-header {
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: white;
            padding: 1.5rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .sidebar-nav {
            padding: 1rem 0;
        }

        .sidebar-nav-item {
            display: flex;
            align-items: center;
            padding: 0.75rem 1.5rem;
            color: var(--text-primary);
            text-decoration: none;
            border-left: 4px solid transparent;
            transition: all 0.2s ease;
            margin: 0.25rem 0.5rem;
            border-radius: 8px;
        }

        .sidebar-nav-item:hover {
            background: rgba(67, 97, 238, 0.1);
            color: var(--primary);
        }

        .sidebar-nav-item.active {
            background: rgba(67, 97, 238, 0.15);
            border-left-color: var(--primary);
            color: var(--primary);
            font-weight: 600;
        }

        .sidebar-nav-item i {
            width: 24px;
            margin-right: 12px;
            font-size: 1.2rem;
        }

        /* Main Content Area */
        .main-content {
            margin-left: 280px;
            padding: 0;
            transition: margin-left 0.3s ease;
        }

        @media (max-width: 768px) {
            .main-content {
                margin-left: 0;
            }
        }

        /* Top Navigation */
        .top-nav {
            background: var(--bg-surface);
            border-bottom: 1px solid var(--border-color);
            padding: 1rem 1.5rem;
            position: sticky;
            top: 0;
            z-index: 900;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .mobile-menu-btn {
            display: none;
            background: none;
            border: none;
            color: var(--text-primary);
            font-size: 1.5rem;
            padding: 0.5rem;
        }

        @media (max-width: 768px) {
            .mobile-menu-btn {
                display: block;
            }
        }

        .status-badge {
            display: inline-flex;
            align-items: center;
            padding: 0.375rem 0.75rem;
            border-radius: 50px;
            font-size: 0.875rem;
            font-weight: 500;
        }

        .status-badge.active {
            background: rgba(76, 201, 240, 0.1);
            color: var(--success);
        }

        .status-badge.inactive {
            background: rgba(230, 57, 70, 0.1);
            color: var(--danger);
        }

        .status-badge::before {
            content: "";
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 6px;
        }

        .status-badge.active::before {
            background: var(--success);
        }

        .status-badge.inactive::before {
            background: var(--danger);
        }

        /* Cards */
        .card {
            background: var(--bg-surface);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            margin-bottom: 1.5rem;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        }

        .card-header {
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            padding: 1.25rem 1.5rem;
            border-radius: 12px 12px 0 0 !important;
            font-weight: 600;
            color: var(--text-primary);
        }

        .card-body {
            padding: 1.5rem;
        }

        /* Tabs */
        .nav-tabs {
            border-bottom: 1px solid var(--border-color);
            padding: 0 1rem;
        }

        .nav-tabs .nav-link {
            border: none;
            padding: 1rem 1.5rem;
            color: var(--text-secondary);
            font-weight: 500;
            border-bottom: 3px solid transparent;
            transition: all 0.2s ease;
        }

        .nav-tabs .nav-link:hover {
            color: var(--primary);
            background: transparent;
        }

        .nav-tabs .nav-link.active {
            color: var(--primary);
            background: transparent;
            border-bottom: 3px solid var(--primary);
        }

        /* Form Controls */
        .form-control, .form-select {
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            padding: 0.75rem 1rem;
            border-radius: 8px;
        }

        .form-control:focus, .form-select:focus {
            background: var(--bg-primary);
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.1);
            color: var(--text-primary);
        }

        .form-label {
            color: var(--text-primary);
            font-weight: 500;
            margin-bottom: 0.5rem;
        }

        /* Interval Controls */
        .interval-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1rem;
        }

        @media (max-width: 576px) {
            .interval-grid {
                grid-template-columns: 1fr;
                gap: 0.75rem;
            }
        }

        .interval-group {
            display: flex;
            flex-direction: column;
        }

        /* Channel List */
        .channel-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 1.25rem;
            margin-bottom: 1rem;
            transition: all 0.2s ease;
        }

        .channel-card:hover {
            border-color: var(--primary);
            transform: translateX(4px);
        }

        .channel-id {
            font-family: 'Courier New', monospace;
            background: rgba(67, 97, 238, 0.1);
            padding: 0.25rem 0.75rem;
            border-radius: 6px;
            color: var(--primary);
            font-weight: 500;
        }

        .channel-message {
            background: var(--bg-primary);
            padding: 1rem;
            border-radius: 8px;
            margin: 1rem 0;
            border-left: 4px solid var(--primary);
            font-size: 0.95rem;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .channel-interval {
            color: var(--text-secondary);
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        /* Action Buttons */
        .btn {
            padding: 0.625rem 1.25rem;
            border-radius: 8px;
            font-weight: 500;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            border: none;
        }

        .btn-primary {
            background: linear-gradient(135deg, var(--primary), var(--primary-dark));
            color: white;
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(67, 97, 238, 0.3);
        }

        .btn-success {
            background: linear-gradient(135deg, #2ecc71, #27ae60);
        }

        .btn-danger {
            background: linear-gradient(135deg, #e74c3c, #c0392b);
        }

        .btn-outline {
            background: transparent;
            border: 1px solid var(--border-color);
            color: var(--text-primary);
        }

        .btn-outline:hover {
            background: var(--bg-secondary);
            border-color: var(--primary);
            color: var(--primary);
        }

        .btn-icon {
            padding: 0.5rem;
            width: 40px;
            height: 40px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
        }

        /* Main Action Buttons */
        .main-actions {
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            display: flex;
            gap: 1rem;
            z-index: 800;
        }

        .action-btn {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            transition: all 0.3s ease;
        }

        .action-btn:hover {
            transform: translateY(-4px) scale(1.05);
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
        }

        .action-btn.start {
            background: linear-gradient(135deg, #2ecc71, #27ae60);
            color: white;
        }

        .action-btn.stop {
            background: linear-gradient(135deg, #e74c3c, #c0392b);
            color: white;
        }

        /* Alert Messages */
        .alert-container {
            position: fixed;
            top: 1rem;
            right: 1rem;
            z-index: 9999;
            max-width: 400px;
        }

        .alert {
            background: var(--bg-surface);
            border: 1px solid var(--border-color);
            border-left: 4px solid;
            border-radius: 8px;
            padding: 1rem 1.25rem;
            margin-bottom: 1rem;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        /* Token Input Group */
        .token-input-group {
            position: relative;
        }

        .token-toggle {
            position: absolute;
            right: 1rem;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: var(--text-secondary);
            padding: 0.5rem;
            cursor: pointer;
            border-radius: 6px;
            transition: all 0.2s ease;
        }

        .token-toggle:hover {
            background: var(--bg-secondary);
            color: var(--primary);
        }

        /* Theme Toggle */
        .theme-toggle {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            padding: 0.5rem;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .theme-toggle:hover {
            background: var(--bg-surface);
            border-color: var(--primary);
        }

        /* Empty State */
        .empty-state {
            text-align: center;
            padding: 3rem 1rem;
            color: var(--text-secondary);
        }

        .empty-state i {
            font-size: 3rem;
            margin-bottom: 1rem;
            opacity: 0.5;
        }

        /* Utility Classes */
        .text-truncate-2 {
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .scrollbar-thin {
            scrollbar-width: thin;
        }

        .scrollbar-thin::-webkit-scrollbar {
            width: 6px;
        }

        .scrollbar-thin::-webkit-scrollbar-track {
            background: var(--bg-secondary);
        }

        .scrollbar-thin::-webkit-scrollbar-thumb {
            background: var(--border-color);
            border-radius: 3px;
        }

        /* Social Hub */
        .social-hub {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-top: 1.5rem;
        }

        .social-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.75rem;
            padding: 1rem 1.5rem;
            border-radius: 10px;
            color: white;
            text-decoration: none;
            font-weight: 500;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            text-align: center;
            border: none;
            cursor: pointer;
        }

        .social-btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
            color: white;
        }

        .social-btn i {
            font-size: 1.25rem;
        }
    </style>
</head>
<body data-theme="{{ 'dark' if config.get('dark_mode', False) else 'light' }}">
    <!-- Alert Container -->
    {% with messages = get_flashed_messages(with_categories=true) %}
        {% if messages %}
            <div class="alert-container">
                {% for category, message in messages %}
                    <div class="alert alert-{{ category }}" role="alert">
                        <div class="d-flex align-items-center justify-content-between">
                            <span>{{ message }}</span>
                            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                        </div>
                    </div>
                {% endfor %}
            </div>
        {% endif %}
    {% endwith %}

    <!-- Sidebar -->
    <div class="sidebar scrollbar-thin">
        <div class="sidebar-header">
            <div>
                <h5 class="mb-1"><i class="bi bi-send-fill me-2"></i>Auto Post</h5>
                <small class="opacity-75">Multi-Token Manager</small>
            </div>
        </div>

        <div class="sidebar-nav">
            <div class="px-3 mb-3">
                <small class="text-uppercase text-muted">Active Bot</small>
                <div class="mt-2 px-2 py-2 bg-{{ 'success' if current_token_data.posting_active else 'danger' }}-subtle rounded">
                    <div class="d-flex align-items-center">
                        <div class="me-2">
                            <i class="bi bi-robot fs-5"></i>
                        </div>
                        <div class="flex-grow-1">
                            <div class="fw-medium">{{ current_token_data.name }}</div>
                            <small class="d-block">
                                <span class="status-badge {{ 'active' if current_token_data.posting_active else 'inactive' }}">
                                    {{ 'Running' if current_token_data.posting_active else 'Stopped' }}
                                </span>
                            </small>
                        </div>
                    </div>
                </div>
            </div>

            <div class="px-3 mb-3">
                <small class="text-uppercase text-muted">Switch Token</small>
            </div>

            {% for token_idx in range(config.tokens | length) %}
                {% set token = config.tokens[token_idx] %}
                <a href="/switch-token/{{ token_idx }}" 
                   class="sidebar-nav-item {% if token_idx == config.current_token_index %}active{% endif %}">
                    <i class="bi bi-robot"></i>
                    <div class="flex-grow-1">
                        <div>{{ token.name }}</div>
                        <small class="text-muted">{{ token.channels|length }} channels</small>
                    </div>
                </a>
            {% endfor %}

            <a href="/add-new-token" class="sidebar-nav-item mt-3">
                <i class="bi bi-plus-circle"></i>
                <span>Add New Token</span>
            </a>
        </div>
    </div>

    <!-- Main Content -->
    <div class="main-content">
        <!-- Top Navigation -->
        <nav class="top-nav">
            <button class="mobile-menu-btn" id="mobileMenuBtn">
                <i class="bi bi-list"></i>
            </button>
            
            <div class="d-flex align-items-center gap-3">
                <button class="theme-toggle" id="themeToggle">
                    <i class="bi {{ 'bi-sun' if config.get('dark_mode', False) else 'bi-moon' }}"></i>
                </button>
                <div class="status-badge {{ 'active' if current_token_data.posting_active else 'inactive' }}">
                    {{ 'Active' if current_token_data.posting_active else 'Stopped' }}
                </div>
            </div>
        </nav>

        <!-- Content -->
        <div class="container-fluid p-4">
            <!-- Tab Navigation -->
            <ul class="nav nav-tabs mb-4" id="mainTabs" role="tablist">
                <li class="nav-item" role="presentation">
                    <button class="nav-link active" id="channels-tab" data-bs-toggle="tab" data-bs-target="#channels">
                        <i class="bi bi-hash me-2"></i>Channels
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link" id="settings-tab" data-bs-toggle="tab" data-bs-target="#settings">
                        <i class="bi bi-gear me-2"></i>Settings
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link" id="webhook-tab" data-bs-toggle="tab" data-bs-target="#webhook">
                        <i class="bi bi-link-45deg me-2"></i>Webhook
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link" id="credit-tab" data-bs-toggle="tab" data-bs-target="#credit">
                        <i class="bi bi-heart me-2"></i>Credit
                    </button>
                </li>
            </ul>

            <div class="tab-content" id="mainTabContent">
                <!-- Channels Tab -->
                <div class="tab-pane fade show active" id="channels">
                    <!-- Add/Edit Channel Form -->
                    <div class="card mb-4">
                        <div class="card-header">
                            <i class="bi {{ 'bi-pencil' if editing else 'bi-plus-circle' }} me-2"></i>
                            {{ 'Edit Channel' if editing else 'Add New Channel' }}
                        </div>
                        <div class="card-body">
                            <form id="channelForm" method="post" action="/save-config">
                                <input type="hidden" name="action" value="{{ 'edit' if editing else 'add' }}">
                                <input type="hidden" name="original_channel_id" value="{{ original_channel_id }}">
                                
                                <div class="row g-3">
                                    <div class="col-md-6">
                                        <label class="form-label">Channel ID</label>
                                        <input type="text" name="channel_id" class="form-control" 
                                               value="{{ channel_id or '' }}" 
                                               {{ 'readonly' if editing else '' }} required>
                                        <div class="form-text">Discord Channel ID where messages will be sent</div>
                                    </div>
                                    
                                    <div class="col-md-6">
                                        <label class="form-label">Posting Interval</label>
                                        <div class="interval-grid">
                                            <div class="interval-group">
                                                <label class="form-label small">Hours</label>
                                                <input type="number" name="hours" class="form-control" 
                                                       value="{{ hours or 0 }}" min="0" required>
                                            </div>
                                            <div class="interval-group">
                                                <label class="form-label small">Minutes</label>
                                                <input type="number" name="minutes" class="form-control" 
                                                       value="{{ minutes or 0 }}" min="0" max="59" required>
                                            </div>
                                            <div class="interval-group">
                                                <label class="form-label small">Seconds</label>
                                                <input type="number" name="seconds" class="form-control" 
                                                       value="{{ seconds or 0 }}" min="0" max="59" required>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div class="col-12">
                                        <label class="form-label">Message Content</label>
                                        <textarea name="message" class="form-control" rows="4" 
                                                  placeholder="Enter message to post..." required>{{ channel_message or '' }}</textarea>
                                        <div class="form-text">Supports Discord markdown and emoji formatting</div>
                                    </div>
                                    
                                    <div class="col-12">
                                        <div class="d-flex gap-2">
                                            <button type="submit" class="btn btn-primary">
                                                <i class="bi {{ 'bi-arrow-repeat' if editing else 'bi-save' }}"></i>
                                                {{ 'Update Channel' if editing else 'Add Channel' }}
                                            </button>
                                            {% if editing %}
                                            <a href="/" class="btn btn-outline">Cancel</a>
                                            {% endif %}
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>

                    <!-- Channels List -->
                    <div class="card">
                        <div class="card-header d-flex justify-content-between align-items-center">
                            <div>
                                <i class="bi bi-list-check me-2"></i>
                                Active Channels ({{ current_token_data.channels|length }})
                            </div>
                        </div>
                        <div class="card-body">
                            {% if current_token_data.channels %}
                                <div class="row g-3">
                                    {% for ch in current_token_data.channels %}
                                    <div class="col-lg-6">
                                        <div class="channel-card">
                                            <div class="d-flex justify-content-between align-items-start mb-2">
                                                <div class="btn-group btn-group-sm">
                                                    <a href="/edit-channel?channel_id={{ ch.id }}&message={{ ch.message|urlencode }}&hours={{ ch.interval//3600 }}&minutes={{ (ch.interval%3600)//60 }}&seconds={{ ch.interval%60 }}"
                                                       class="btn btn-outline">
                                                        <i class="bi bi-pencil"></i>
                                                    </a>
                                                    <form method="post" action="/save-config" 
                                                          onsubmit="return confirm('Delete this channel?');"
                                                          class="d-inline">
                                                        <input type="hidden" name="action" value="remove">
                                                        <input type="hidden" name="channel_id" value="{{ ch.id }}">
                                                        <button type="submit" class="btn btn-outline">
                                                            <i class="bi bi-trash"></i>
                                                        </button>
                                                    </form>
                                                </div>
                                                
                                            </div>
                                            
                                                <div>
                                                    <span class="channel-id">#{{ ch.id }}</span>
                                                    {% if current_token_data.posting_active %}
                                                    <span class="badge bg-success bg-opacity-10 text-success ms-2">
                                                        <i class="bi bi-circle-fill me-1"></i>Active
                                                    </span>
                                                    {% endif %}
                                                </div>

                                            <div class="channel-interval mb-3">
                                                <i class="bi bi-clock"></i>
                                                Every {{ ch.interval//3600 }}h {{ (ch.interval%3600)//60 }}m {{ ch.interval%60 }}s
                                            </div>
                                            
                                            <div class="channel-message">
                                                {{ ch.message }}
                                            </div>
                                        </div>
                                    </div>
                                    {% endfor %}
                                </div>
                            {% else %}
                                <div class="empty-state">
                                    <i class="bi bi-hash text-muted"></i>
                                    <h5 class="mt-3">No channels configured</h5>
                                    <p class="text-muted">Add your first channel above to start auto-posting</p>
                                </div>
                            {% endif %}
                        </div>
                    </div>
                </div>

                <!-- Settings Tab -->
                <div class="tab-pane fade" id="settings">
                    <div class="card">
                        <div class="card-header">
                            <i class="bi bi-key me-2"></i>
                            Discord Bot Token
                        </div>
                        <div class="card-body">
                            <form method="post" action="/save-config">
                                <div class="mb-3">
                                    <label class="form-label">Bot Token</label>
                                    <div class="token-input-group">
                                        <input type="password" name="token" class="form-control" 
                                               value="{{ current_token_data.token }}" required>
                                        <button type="button" class="token-toggle" id="tokenToggle">
                                            <i class="bi bi-eye"></i>
                                        </button>
                                    </div>
                                    <div class="form-text text-danger mt-2">
                                        <i class="bi bi-exclamation-triangle me-1"></i>
                                        Keep your token secure and never share it publicly
                                    </div>
                                </div>
                                <button type="submit" class="btn btn-primary">
                                    <i class="bi bi-save me-2"></i>Save Token
                                </button>
                            </form>
                        </div>
                    </div>
                </div>

                <!-- Webhook Tab -->
                <div class="tab-pane fade" id="webhook">
                    <div class="card">
                        <div class="card-header">
                            <i class="bi bi-link-45deg me-2"></i>
                            Webhook Configuration
                        </div>
                        <div class="card-body">
                            <form method="post" action="/save-config">
                                <div class="mb-3">
                                    <div class="form-check form-switch">
                                        <input class="form-check-input" type="checkbox" id="useWebhook" 
                                               name="use_webhook" {% if current_token_data.use_webhook %}checked{% endif %}>
                                        <label class="form-check-label" for="useWebhook">
                                            Enable Webhook Logging
                                        </label>
                                    </div>
                                </div>
                                
                                <div class="mb-3">
                                    <label class="form-label">Webhook URL</label>
                                    <input type="url" name="webhook_url" class="form-control" 
                                           value="{{ current_token_data.webhook_url }}" 
                                           placeholder="https://discord.com/api/webhooks/...">
                                    <div class="form-text">
                                        Set up a Discord webhook to receive posting status updates
                                    </div>
                                </div>
                                
                                <div class="d-flex gap-2">
                                    <button type="submit" class="btn btn-primary">
                                        <i class="bi bi-save me-2"></i>Save Webhook
                                    </button>
                                    <button type="button" class="btn btn-outline" onclick="testWebhook()">
                                        <i class="bi bi-send-check me-2"></i>Test Webhook
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>

                <!-- Credit Tab -->
                <div class="tab-pane fade" id="credit">
                    <div class="card">
                        <div class="card-header">
                            <i class="bi bi-heart me-2"></i>
                            About & Credits
                        </div>
                        <div class="card-body">
                            <h5>Auto Post Discord Bot</h5>
                            <p>
                                This tool is designed to automate posting messages to Discord channels using multiple bot tokens. 
                                It allows you to manage multiple Discord bots, each with its own set of channels and posting intervals.
                                You can also enable webhook logging to track the status of your posts.
                            </p>
                            <p>
                                Its free and open-source, built with Flask and Bootstrap for a seamless user experience.
                            </p>
                            <hr>
                            <h5>Developer & Social Links</h5>
                            <p>
                                Developed by <strong>Void_String/LRiqlapa</strong>. Feel free to join our community, check out the YouTube channel, 
                                and support the project!
                            </p>
                            <div class="social-hub">
                                <a href="https://discord.com/invite/psdQaVEnHt" target="_blank" class="social-btn" style="background: linear-gradient(135deg, #5865f2, #4752c4);">
                                    <i class="fab fa-discord"></i>
                                    Discord Community
                                </a>
                                <a href="https://www.youtube.com/@BuronanBelang" target="_blank" class="social-btn" style="background: linear-gradient(135deg, #ff0000, #cc0000);">
                                    <i class="fab fa-youtube"></i>
                                    YouTube Channel
                                </a>
                                <a href="https://github.com/LRiqlapa" target="_blank" class="social-btn" style="background: linear-gradient(135deg, #333, #24292e);">
                                    <i class="fab fa-github"></i>
                                    GitHub Profile
                                </a>
                                <a href="https://saweria.co/BuronanBelang" target="_blank" class="social-btn" style="background: linear-gradient(135deg, #e67e22, #d35400);">
                                    <i class="fas fa-hand-holding-heart"></i>
                                    Support Project
                                </a>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </div>

    <!-- Main Action Buttons -->
    <div class="main-actions">
        {% if current_token_data.posting_active %}
        <form action="/stop" method="post" class="d-inline">
            <button type="submit" class="action-btn stop" title="Stop Auto Posting">
                <i class="bi bi-stop-fill"></i>
            </button>
        </form>
        {% else %}
        <form action="/start" method="post" class="d-inline">
            <button type="submit" class="action-btn start" title="Start Auto Posting">
                <i class="bi bi-play-fill"></i>
            </button>
        </form>
        {% endif %}
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script>
        // Mobile Menu Toggle
        document.getElementById('mobileMenuBtn').addEventListener('click', function() {
            document.body.classList.toggle('sidebar-open');
        });

        // Theme Toggle
        document.getElementById('themeToggle').addEventListener('click', function() {
            const isDark = document.body.getAttribute('data-theme') === 'dark';
            const newTheme = isDark ? 'light' : 'dark';
            
            document.body.setAttribute('data-theme', newTheme);
            this.innerHTML = `<i class="bi ${isDark ? 'bi-moon' : 'bi-sun'}"></i>`;
            
            fetch('/save-dark-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dark_mode: !isDark })
            });
        });

        // Token Visibility Toggle
        document.getElementById('tokenToggle').addEventListener('click', function() {
            const input = document.querySelector('input[name="token"]');
            const icon = this.querySelector('i');
            
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.replace('bi-eye', 'bi-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.replace('bi-eye-slash', 'bi-eye');
            }
        });

        // Test Webhook Function
        function testWebhook() {
            fetch('/test-webhook', { method: 'POST' })
                .then(response => {
                    if (response.ok) {
                        alert('Webhook test sent successfully!');
                    } else {
                        alert('Failed to send webhook test.');
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    alert('Error sending webhook test.');
                });
        }

        // Auto-dismiss alerts after 5 seconds
        setTimeout(() => {
            document.querySelectorAll('.alert').forEach(alert => {
                const bsAlert = new bootstrap.Alert(alert);
                bsAlert.close();
            });
        }, 5000);

        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', function(event) {
            if (window.innerWidth <= 768) {
                const sidebar = document.querySelector('.sidebar');
                const menuBtn = document.getElementById('mobileMenuBtn');
                
                if (!sidebar.contains(event.target) && !menuBtn.contains(event.target)) {
                    document.body.classList.remove('sidebar-open');
                }
            }
        });

        // Initialize tabs
        const triggerTabList = [].slice.call(document.querySelectorAll('#mainTabs button'));
        triggerTabList.forEach(triggerEl => {
            triggerEl.addEventListener('click', event => {
                event.preventDefault();
                const tab = new bootstrap.Tab(triggerEl);
                tab.show();
            });
        });
    </script>
</body>
</html>
'''

if __name__ == "__main__":
    load_config()
    app.run(debug=True, host="0.0.0.0", port=5000)