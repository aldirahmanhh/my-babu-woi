const {
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ThumbnailBuilder,
  SectionBuilder,
  ActionRowBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");
const store = require("./autopost-store");
const cfg = require("../config/config.json");

const activePosters = {};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns the avatar URL to use for panels.
 * Uses custom URL from config if set, otherwise falls back to bot avatar.
 */
function getAvatarURL(client) {
  if (cfg.avatarUrl && cfg.avatarUrl.trim() !== "") {
    return cfg.avatarUrl.trim();
  }
  return client.user.displayAvatarURL({ extension: "png", size: 512 });
}

/**
 * Returns banner image URL for a specific panel type.
 * Falls back to bot avatar if not configured.
 */
function getBanner(client, key) {
  const custom = cfg.images && cfg.images[key];
  if (custom && custom.trim() !== "") {
    return custom.trim();
  }
  return client.user.displayAvatarURL({ extension: "png", size: 512 });
}

/**
 * Returns thumbnail image URL for a specific panel type.
 * Falls back to bot avatar if not configured.
 */
function getThumbnail(client, key) {
  const custom = cfg.images && cfg.images[key];
  if (custom && custom.trim() !== "") {
    return custom.trim();
  }
  return client.user.displayAvatarURL({ extension: "png", size: 512 });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns a compact human-readable interval string.
 * e.g. 3661 → "1h 1m 1s", 300 → "5m", 45 → "45s"
 */
function formatInterval(seconds) {
  if (!seconds || seconds <= 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0) parts.push(`${s}s`);
  return parts.length > 0 ? parts.join(" ") : "0s";
}

/** Creates a thin divider separator (new instance every call). */
const sep = () =>
  new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);

/**
 * Builds a welcome container for private rooms.
 * Component count: Container(1) + MediaGallery(1) + Item(1) + Sep(1) + Section(1) + 2×TD(2) + Thumb(1) = 8
 */
function buildWelcomeContainer(client, username) {
  const bannerURL = getBanner(client, "welcomeBanner");
  const thumbURL = getThumbnail(client, "welcomeThumbnail");

  const thumbnail = new ThumbnailBuilder({ media: { url: thumbURL } });
  const banner = new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(bannerURL),
  );

  const welcomeSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `👋 **Welcome to your Private Room, <@${username}>!**`,
      ),
      new TextDisplayBuilder().setContent(
        "Your private AutoPost room is ready. Use the panel below to manage your channels, token, and Auto-Login settings.",
      ),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId("ap_open_panel")
        .setLabel("Open AutoPost Panel")
        .setStyle(ButtonStyle.Secondary),
    );

  const welcomeContainer = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addMediaGalleryComponents(banner)
    .addSeparatorComponents(sep())
    .addSectionComponents(welcomeSection);

  return { container: welcomeContainer };
}

// ─── Main AutoPost Panel ─────────────────────────────────────────────────────
//
// Component budget (must stay ≤ 40 when sent alone, ≤ 32 when paired with
// the 8-component welcome container):
//
//   Container        1
//   MediaGallery     1
//   MediaGalleryItem 1
//   Separator        1
//   Section          1   ← status
//   TextDisplay      1
//   TextDisplay      1
//   Thumbnail        1
//   Separator        1
//   TextDisplay      1   ← channel list header
//   TextDisplay      1   ← channel list body
//   Separator        1
//   Section+TD+Btn   3   ← toggle post
//   Section+TD+Btn   3   ← add channel
//   Section+TD+Btn   3   ← remove channel
//   Separator        1
//   Section+TD+Btn   3   ← set token
//   Section+TD+Btn   3   ← auto-login
//   Section+TD+Btn   3   ← create room
//                   ──
//                   31  ✓
//   + welcome(8) = 39 total ✓
//
function buildPanel(userId, client) {
  const config = store.getUserConfig(userId);
  const isRunning = !!activePosters[userId];
  const hasToken = !!config.autoLoginToken;

  const bannerURL = getBanner(client, "panelBanner");
  const thumbURL = getThumbnail(client, "panelThumbnail");
  const thumbnail = new ThumbnailBuilder({ media: { url: thumbURL } });

  // ── Banner ────────────────────────────────────────────────────────────────
  const banner = new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(bannerURL),
  );

  // ── Status section ────────────────────────────────────────────────────────
  const runBadge = isRunning ? "🟢 **Active**" : "🔴 **Stopped**";
  const tokenBadge = hasToken ? "✅ Token" : "❌ No Token";
  const chCount = config.channels.length;

  const statusSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("⚡ **AutoPost Manager**"),
      new TextDisplayBuilder().setContent(
        `${runBadge}  ·  ${tokenBadge}  ·  📡 **${chCount}** channel${chCount !== 1 ? "s" : ""}`,
      ),
    )
    .setThumbnailAccessory(thumbnail);

  // ── Channel list ──────────────────────────────────────────────────────────
  const channelListText =
    config.channels.length > 0
      ? config.channels
          .map(
            (ch) => `> 📻 <#${ch.id}>  —  \`${formatInterval(ch.interval)}\``,
          )
          .join("\n")
      : "> *No channels configured yet. Use **Add** to get started.*";

  // ── Post-control sections (group 1) ───────────────────────────────────────
  const toggleSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        isRunning ? "⏹️ **Stop AutoPost**" : "▶️ **Start AutoPost**",
      ),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId("ap_toggle_post")
        .setLabel(isRunning ? "Stop" : "Start")
        .setStyle(isRunning ? ButtonStyle.Danger : ButtonStyle.Success),
    );

  const addChannelSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("➕ **Add Channel**"),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId("ap_add_channel")
        .setLabel("Add")
        .setStyle(ButtonStyle.Primary),
    );

  const removeSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("🗑️ **Remove Channel**"),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId("ap_remove_channel")
        .setLabel("Remove")
        .setStyle(ButtonStyle.Danger),
    );

  // ── Settings sections (group 2) ───────────────────────────────────────────
  const setTokenSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("🔑 **User Token**"),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId("ap_set_token")
        .setLabel(hasToken ? "Update" : "Set Token")
        .setStyle(hasToken ? ButtonStyle.Secondary : ButtonStyle.Danger),
    );

  const autoLoginSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("🤖 **Auto-Login**"),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId("ap_auto_login")
        .setLabel("Configure")
        .setStyle(ButtonStyle.Secondary),
    );

  const createRoomSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("🔒 **Private Room**"),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId("ap_create_room")
        .setLabel("Create Room")
        .setStyle(ButtonStyle.Success),
    );

  // ── Assemble ──────────────────────────────────────────────────────────────
  const accentColor = isRunning ? 0x57f287 : 0x5865f2;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addMediaGalleryComponents(banner)
    .addSeparatorComponents(sep())
    .addSectionComponents(statusSection)
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("📡 **Configured Channels**"),
      new TextDisplayBuilder().setContent(channelListText),
    )
    .addSeparatorComponents(sep())
    .addSectionComponents(toggleSection, addChannelSection, removeSection)
    .addSeparatorComponents(sep())
    .addSectionComponents(setTokenSection, autoLoginSection, createRoomSection);

  return { container };
}

// ─── Auto-Login Panel ────────────────────────────────────────────────────────
//
// Component budget:
//
//   Container        1
//   MediaGallery     1
//   MediaGalleryItem 1
//   Separator        1
//   Section          1   ← status
//   TextDisplay      1
//   TextDisplay      1
//   TextDisplay      1
//   Thumbnail        1
//   Separator        1
//   Section+TD+Btn   3   ← toggle
//   Section+TD+Btn   3   ← set channel
//   Section+TD+Btn   3   ← back
//                   ──
//                   19  ✓
//
function buildAutoLoginPanel(userId, client) {
  const config = store.getUserConfig(userId);
  const isEnabled = config.autoLoginEnabled;

  const bannerURL = client
    ? getBanner(client, "autoLoginBanner")
    : "https://cdn.discordapp.com/embed/avatars/0.png";
  const thumbURL = client
    ? getThumbnail(client, "autoLoginThumbnail")
    : "https://cdn.discordapp.com/embed/avatars/0.png";

  const thumbnail = new ThumbnailBuilder({ media: { url: thumbURL } });

  // ── Banner ────────────────────────────────────────────────────────────────
  const banner = new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(bannerURL),
  );

  // ── Status section ────────────────────────────────────────────────────────
  const statusBadge = isEnabled ? "🟢 **Enabled**" : "🔴 **Disabled**";

  const statusSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("🔑 **Auto-Login Manager**"),
      new TextDisplayBuilder().setContent(statusBadge),
      new TextDisplayBuilder().setContent(
        `👁️ **Watch Channel:** <#${config.autoLoginChannel}>`,
      ),
    )
    .setThumbnailAccessory(thumbnail);

  // ── Control sections ──────────────────────────────────────────────────────
  const toggleSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        isEnabled ? "🔴 **Disable Auto-Login**" : "🟢 **Enable Auto-Login**",
      ),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId("ap_al_toggle")
        .setLabel(isEnabled ? "Disable" : "Enable")
        .setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    );

  const channelSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("👁️ **Set Watch Channel**"),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId("ap_al_set_channel")
        .setLabel("Set Channel")
        .setStyle(ButtonStyle.Primary),
    );

  const backSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("⬅️ **Back to Panel**"),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId("ap_back_to_panel")
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary),
    );

  // ── Assemble ──────────────────────────────────────────────────────────────
  const accentColor = isEnabled ? 0x57f287 : 0x5865f2;

  const container = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addMediaGalleryComponents(banner)
    .addSeparatorComponents(sep())
    .addSectionComponents(statusSection)
    .addSeparatorComponents(sep())
    .addSectionComponents(toggleSection, channelSection, backSection);

  return { container };
}

// ─── Remove-channel select menu ──────────────────────────────────────────────

function buildRemoveChannelSelect(userId) {
  const config = store.getUserConfig(userId);
  if (config.channels.length === 0) return null;

  const select = new StringSelectMenuBuilder()
    .setCustomId("ap_remove_select")
    .setPlaceholder("Select a channel to remove…")
    .addOptions(
      config.channels.map((ch) => ({
        label: `Channel ${ch.id}`,
        description: `Every ${formatInterval(ch.interval)}`,
        value: ch.id,
      })),
    );

  return new ActionRowBuilder().addComponents(select);
}

// ─── AutoPost engine ─────────────────────────────────────────────────────────

async function sendViaUserToken(token, channelId, message) {
  const res = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: message }),
    },
  );
  return res.status;
}

function startAutoPost(userId) {
  if (activePosters[userId]) return;

  const config = store.getUserConfig(userId);
  if (config.channels.length === 0) return;
  if (!config.autoLoginToken) return;

  activePosters[userId] = {};

  for (const ch of config.channels) {
    const post = async () => {
      while (activePosters[userId]) {
        try {
          const status = await sendViaUserToken(
            config.autoLoginToken,
            ch.id,
            ch.message,
          );
          if (status !== 200 && status !== 204) {
            console.error(`[AUTOPOST] Post failed to ${ch.id}: ${status}`);
          }
        } catch (e) {
          console.error(`[AUTOPOST] Error posting to ${ch.id}:`, e.message);
        }
        if (!activePosters[userId]) break;
        await new Promise((resolve) => setTimeout(resolve, ch.interval * 1000));
      }
    };
    activePosters[userId][ch.id] = post();
  }
}

function stopAutoPost(userId) {
  if (activePosters[userId]) {
    delete activePosters[userId];
  }
}

function isAutoPostActive(userId) {
  return !!activePosters[userId];
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  buildPanel,
  buildAutoLoginPanel,
  buildWelcomeContainer,
  buildRemoveChannelSelect,
  startAutoPost,
  stopAutoPost,
  isAutoPostActive,
  formatInterval,
  activePosters,
};
