const { MessageFlags, TextDisplayBuilder, ContainerBuilder, SectionBuilder, ThumbnailBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ChannelSelectMenuBuilder } = require('discord.js');
const store = require('./autopost-store');

const loginWorkers = {};

class AutoLoginWorker {
    constructor(userId, token, client) {
        this.userId = userId;
        this.token = this.normalizeToken(token);
        this.client = client;
        this.ws = null;
        this.running = false;
        this.sessionId = null;
        this.discordUserId = null;
        this.cachedGuildId = null;
        this.headers = {
            Authorization: this.token,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
    }

    normalizeToken(token) {
        if (!token) return '';
        return token.trim().replace(/^['"]|['"]$/g, '');
    }

    async verifyToken() {
        const prefixes = ['', 'Bot ', 'Bearer '];
        for (const prefix of prefixes) {
            try {
                const testToken = prefix === 'Bearer ' ? `Bearer ${this.normalizeToken(this.token)}` : `${prefix}${this.token}`;
                this.headers.Authorization = testToken;
                const res = await fetch('https://discord.com/api/v9/users/@me', {
                    headers: this.headers
                });
                if (res.ok) {
                    const data = await res.json();
                    this.discordUserId = data.id;
                    this.token = testToken;
                    return true;
                }
            } catch {
                continue;
            }
        }
        return false;
    }

    start(channelId) {
        if (this.running) return;
        this.running = true;
        this.channelId = channelId;
        this.connectWs();
    }

    stop() {
        this.running = false;
        if (this.ws) {
            this.ws.close();
        }
    }

    connectWs() {
        const WebSocket = require('ws');
        this.ws = new WebSocket('wss://gateway.discord.gg/?v=9&encoding=json');

        this.ws.on('open', () => {
            console.log(`[AUTOLOGIN-${this.userId}] Connected to gateway`);
        });

        this.ws.on('message', (data) => {
            if (!this.running) return;
            try {
                const msg = JSON.parse(data.toString());
                this.handleGatewayMessage(msg);
            } catch (e) {
                console.error(`[AUTOLOGIN-${this.userId}] Parse error:`, e.message);
            }
        });

        this.ws.on('close', (code) => {
            console.log(`[AUTOLOGIN-${this.userId}] Gateway closed: ${code}`);
            if (this.running) {
                setTimeout(() => this.connectWs(), 5000);
            }
        });

        this.ws.on('error', (err) => {
            console.error(`[AUTOLOGIN-${this.userId}] WS error:`, err.message);
        });
    }

    handleGatewayMessage(data) {
        const { op, t, d } = data;

        if (op === 10) {
            const heartbeatInterval = d.heartbeat_interval / 1000;
            this.startHeartbeat(heartbeatInterval);

            this.ws.send(JSON.stringify({
                op: 2,
                d: {
                    token: this.token,
                    capabilities: 16381,
                    properties: {
                        os: 'Windows',
                        browser: 'Chrome',
                        device: '',
                        system_locale: 'en-US',
                        browser_user_agent: this.headers['User-Agent'],
                        browser_version: '120.0.0.0',
                        os_version: '10',
                        referrer: '',
                        referring_domain: '',
                        referrer_current: '',
                        referring_domain_current: '',
                        release_channel: 'stable',
                        client_build_number: 263509,
                        client_event_source: null
                    },
                    presence: { status: 'online', since: 0, activities: [], afk: false },
                    compress: false,
                    client_state: {
                        guild_versions: {},
                        highest_last_message_id: '0',
                        read_state_version: 0,
                        user_guild_settings_version: -1,
                        user_settings_version: -1,
                        private_channels_version: '0',
                        api_code_version: 0
                    }
                }
            }));
        } else if (t === 'READY') {
            this.sessionId = d.session_id;
            console.log(`[AUTOLOGIN-${this.userId}] Ready! Session: ${this.sessionId}`);
        } else if (t === 'MESSAGE_CREATE') {
            this.handleMessage(d);
        }
    }

    startHeartbeat(interval) {
        const beat = () => {
            if (!this.running || !this.ws || this.ws.readyState !== 1) return;
            this.ws.send(JSON.stringify({ op: 1, d: null }));
            setTimeout(beat, interval * 1000);
        };
        setTimeout(beat, interval * 1000);
    }

    handleMessage(d) {
        if (d.channel_id !== this.channelId) return;

        if (d.guild_id) this.cachedGuildId = d.guild_id;

        const mentions = d.mentions || [];
        const flags = d.flags || 0;
        const isEphemeral = (flags & 64) === 64;

        const mentioned = mentions.some(u => u.id === this.discordUserId);
        if (!mentioned && !isEphemeral) return;

        const components = d.components || [];
        for (const row of components) {
            for (const comp of (row.components || [])) {
                if (comp.type === 2) {
                    if (comp.label === 'Authenticate') {
                        setTimeout(() => {
                            this.clickButton(d.guild_id, d.channel_id, d.id, d.author.id, comp.custom_id, flags);
                        }, 1500 + Math.random() * 3000);
                    } else if (comp.label === 'Yes, Log Me In') {
                        setTimeout(() => {
                            this.clickButton(d.guild_id || this.cachedGuildId, d.channel_id, d.id, d.author.id, comp.custom_id, flags);
                        }, 1000 + Math.random() * 2000);
                    }
                }
            }
        }
    }

    async clickButton(guildId, channelId, messageId, applicationId, customId, messageFlags = 0) {
        if (!this.sessionId) return;
        if (!guildId && this.cachedGuildId) guildId = this.cachedGuildId;

        const payload = {
            type: 3,
            nonce: String(Date.now() * 10000),
            guild_id: guildId,
            channel_id: channelId,
            message_id: messageId,
            application_id: applicationId,
            data: { component_type: 2, custom_id: customId },
            session_id: this.sessionId
        };

        if (messageFlags & 64) payload.message_flags = 64;

        try {
            const res = await fetch('https://discord.com/api/v9/interactions', {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(payload)
            });
            if (res.ok || res.status === 204) {
                console.log(`[AUTOLOGIN-${this.userId}] Click success: ${customId}`);
            } else if (res.status === 429) {
                const data = await res.json();
                console.log(`[AUTOLOGIN-${this.userId}] Rate limited: ${data.retry_after}s`);
            } else {
                console.log(`[AUTOLOGIN-${this.userId}] Click failed: ${res.status}`);
            }
        } catch (e) {
            console.error(`[AUTOLOGIN-${this.userId}] Click error:`, e.message);
        }
    }
}

function startAutoLogin(userId, token, channelId, client) {
    if (loginWorkers[userId]) {
        loginWorkers[userId].stop();
    }
    const worker = new AutoLoginWorker(userId, token, client);
    worker.start(channelId);
    loginWorkers[userId] = worker;
}

function stopAutoLogin(userId) {
    if (loginWorkers[userId]) {
        loginWorkers[userId].stop();
        delete loginWorkers[userId];
    }
}

function isAutoLoginActive(userId) {
    return !!loginWorkers[userId];
}

module.exports = {
    startAutoLogin,
    stopAutoLogin,
    isAutoLoginActive,
    AutoLoginWorker
};
