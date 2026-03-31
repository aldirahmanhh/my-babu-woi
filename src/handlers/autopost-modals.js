const {
  MessageFlags,
  TextDisplayBuilder,
  ContainerBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = require("discord.js");
const store = require("../utils/autopost-store");
const {
  buildPanel,
  buildWelcomeContainer,
  startAutoPost,
  isAutoPostActive,
  formatInterval,
  buildAutoLoginPanel,
} = require("../utils/autopost-builder");
const {
  startAutoLogin,
  isAutoLoginActive,
} = require("../utils/autologin-worker");
const cfg = require("../config/config.json");

async function refreshUserPanel(client, userId) {
  const room = store.getUserRoom(userId);
  if (!room || !room.panelMessageId) return;
  try {
    const channel = await client.channels.fetch(room.channelId).catch(() => null);
    if (!channel) return;
    const msg = await channel.messages.fetch(room.panelMessageId).catch(() => null);
    if (!msg) return;
    const { container: welcomeContainer } = buildWelcomeContainer(client, userId);
    const { container: panelContainer } = buildPanel(userId, client);
    await msg.edit({
      flags: MessageFlags.IsComponentsV2,
      components: [welcomeContainer, panelContainer],
    });
  } catch (e) {
    console.error("[REFRESH] Failed to refresh panel:", e.message);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Thin divider separator (new instance each call). */
const sep = () =>
  new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);

/**
 * Returns a small thumbnail builder using the bot avatar.
 * @param {import('discord.js').Client} client
 * @param {128|512} [size=128]
 */
function botThumb(client, size = 128) {
  const url = cfg.images && cfg.images.panelThumbnail && cfg.images.panelThumbnail.trim() !== ""
    ? cfg.images.panelThumbnail.trim()
    : client.user.displayAvatarURL({ extension: "png", size });
  return new ThumbnailBuilder({
    media: { url },
  });
}

/**
 * Returns a MediaGallery banner using the bot avatar.
 * @param {import('discord.js').Client} client
 */
function botBanner(client) {
  const url = cfg.images && cfg.images.panelBanner && cfg.images.panelBanner.trim() !== ""
    ? cfg.images.panelBanner.trim()
    : client.user.displayAvatarURL({ extension: "png", size: 512 });
  return new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(url),
  );
}

// ─── Module ───────────────────────────────────────────────────────────────────

module.exports = {
  name: "interactionCreate",
  once: false,
  async execute(client, interaction) {
    if (!interaction.isModalSubmit()) return;

    const { customId } = interaction;

    if (customId === "ap_add_channel_modal") {
      await handleAddChannelModal(client, interaction);
    } else if (customId === "ap_set_token_modal") {
      await handleSetTokenModal(client, interaction);
    } else if (customId === "ap_al_token_modal") {
      await handleAutoLoginTokenModal(client, interaction);
    }
  },
};

// ─── Modal Handlers ───────────────────────────────────────────────────────────

async function handleAddChannelModal(client, interaction) {
  const userId = interaction.user.id;
  const channelId = interaction.fields.getTextInputValue("ch_id");
  const message = interaction.fields.getTextInputValue("ch_message");
  const hours = parseInt(interaction.fields.getTextInputValue("ch_hours")) || 0;
  const minutes =
    parseInt(interaction.fields.getTextInputValue("ch_minutes")) || 0;
  const seconds =
    parseInt(interaction.fields.getTextInputValue("ch_seconds")) || 0;

  const interval = hours * 3600 + minutes * 60 + seconds;

  if (interval <= 0) {
    // Error container — Container(1) + Section(1) + 2×TD(2) + Thumb(1) = 5 ✓
    const container = new ContainerBuilder()
      .setAccentColor(0xed4245)
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("❌ **Invalid Interval**"),
            new TextDisplayBuilder().setContent(
              "Interval must be at least **1 second**. Please try again.",
            ),
          )
          .setThumbnailAccessory(botThumb(client)),
      );

    return interaction.reply({
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      components: [container],
    });
  }

  const added = store.addChannel(userId, { id: channelId, message, interval });

  if (!added) {
    // Duplicate channel container — 5 components ✓
    const container = new ContainerBuilder()
      .setAccentColor(0xfee75c)
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              "⚠️ **Channel Already Exists**",
            ),
            new TextDisplayBuilder().setContent(
              `<#${channelId}> is already in your AutoPost config.`,
            ),
          )
          .setThumbnailAccessory(botThumb(client)),
      );

    return interaction.reply({
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      components: [container],
    });
  }

  // Success container:
  //   Container(1) + Section(1) + 3×TD(3) + Thumb(1) = 6
  //   ActionRow(1) + Button(1)                        = 2
  //                                             total  = 8 ✓
  const preview =
    message.length > 100 ? `${message.substring(0, 100)}…` : message;

  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent("✅ **Channel Added!**"),
          new TextDisplayBuilder().setContent(
            `📻 <#${channelId}>  —  every \`${formatInterval(interval)}\``,
          ),
          new TextDisplayBuilder().setContent(`📝 *${preview}*`),
        )
        .setThumbnailAccessory(botThumb(client, 512)),
    );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ap_back_to_panel")
      .setLabel("Back to Panel")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    flags: MessageFlags.IsComponentsV2,
    components: [container, actionRow],
  });

  await refreshUserPanel(client, userId);
}

async function handleSetTokenModal(client, interaction) {
  const userId = interaction.user.id;
  const token = interaction.fields.getTextInputValue("token_input");

  const config = store.getUserConfig(userId);
  config.autoLoginToken = token;
  store.setUserConfig(userId, config);

  // Confirmation banner — kept small so the pair stays under 40:
  //   confirmContainer: Container(1) + Section(1) + 2×TD(2) + Thumb(1) = 5
  //   mainPanel:                                                         31
  //                                                             total = 36 ✓
  const confirmContainer = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent("✅ **Token Saved!**"),
          new TextDisplayBuilder().setContent(
            "Your token is now active and will be used for both AutoPost and Auto-Login.",
          ),
        )
        .setThumbnailAccessory(botThumb(client)),
    );

  const { container: mainPanel } = buildPanel(userId, client);

  await interaction.reply({
    flags: MessageFlags.IsComponentsV2,
    components: [confirmContainer, mainPanel],
  });

  await refreshUserPanel(client, userId);
}

async function handleAutoLoginTokenModal(client, interaction) {
  const userId = interaction.user.id;
  const token = interaction.fields.getTextInputValue("al_token");

  const config = store.getUserConfig(userId);
  config.autoLoginToken = token;
  config.autoLoginEnabled = true;
  store.setUserConfig(userId, config);

  startAutoLogin(userId, token, config.autoLoginChannel, client);
  const isActive = isAutoLoginActive(userId);

  // Component count:
  //   Container(1) + MediaGallery(1) + Item(1) + Sep(1)
  //   + Section(1) + 3×TD(3) + Thumb(1)               = 9
  //   ActionRow(1) + 3×Button(3)                       = 4
  //                                             total  = 13 ✓
  const container = new ContainerBuilder()
    .setAccentColor(isActive ? 0x57f287 : 0xed4245)
    .addMediaGalleryComponents(botBanner(client))
    .addSeparatorComponents(sep())
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            isActive ? "🟢 **Auto-Login Active**" : "🔴 **Auto-Login Failed**",
          ),
          new TextDisplayBuilder().setContent(
            `👁️ Monitoring: <#${config.autoLoginChannel}>`,
          ),
          new TextDisplayBuilder().setContent(
            isActive
              ? "Watching for **Authenticate** / **Log Me In** buttons…"
              : "Could not start. Please verify your token and try again.",
          ),
        )
        .setThumbnailAccessory(botThumb(client, 512)),
    );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ap_al_toggle")
      .setLabel(isActive ? "Stop" : "Start")
      .setStyle(isActive ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("ap_al_set_channel")
      .setLabel("Set Channel")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("ap_back_to_panel")
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    flags: MessageFlags.IsComponentsV2,
    components: [container, actionRow],
  });
}
