const {
  SlashCommandBuilder,
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
const store = require("../../utils/autopost-store");
const {
  isAutoLoginActive,
  startAutoLogin,
} = require("../../utils/autologin-worker");
const cfg = require("../../config/config.json");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Thin divider separator (new instance each call). */
const sep = () =>
  new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);

/**
 * Returns a thumbnail using the bot avatar.
 * @param {import('discord.js').Client} client
 * @param {128|512} [size=512]
 */
function botThumb(client, size = 512) {
  const url = cfg.images && cfg.images.autoLoginThumbnail && cfg.images.autoLoginThumbnail.trim() !== ""
    ? cfg.images.autoLoginThumbnail.trim()
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
  const url = cfg.images && cfg.images.autoLoginBanner && cfg.images.autoLoginBanner.trim() !== ""
    ? cfg.images.autoLoginBanner.trim()
    : client.user.displayAvatarURL({ extension: "png", size: 512 });
  return new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(url),
  );
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName("autologin")
    .setDescription(
      "Configure Auto-Login (only usable inside your private room)",
    )
    .addStringOption((option) =>
      option
        .setName("token")
        .setDescription("Your Discord user token")
        .setRequired(true),
    ),

  /**
   * @param {import('discord.js').Client} client
   * @param {import('discord.js').CommandInteraction} interaction
   */
  run: async (client, interaction) => {
    const userId = interaction.user.id;
    const channelId = interaction.channel.id;

    // ── Guard: must be inside the user's private room ─────────────────────────
    const room = store.getUserRoom(userId);
    if (!room || room.channelId !== channelId) {
      // Component count: Container(1) + Section(1) + 2×TD(2) + Thumb(1) = 5 ✓
      const errorContainer = new ContainerBuilder()
        .setAccentColor(0xed4245)
        .addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent("❌ **Wrong Channel**"),
              new TextDisplayBuilder().setContent(
                "Auto-Login can only be configured inside your **private room**.\n" +
                  "Use `/autopost` → **Create Room**, then run this command there.",
              ),
            )
            .setThumbnailAccessory(botThumb(client, 128)),
        );

      return interaction.reply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [errorContainer],
      });
    }

    // ── Save token & start worker ──────────────────────────────────────────────
    const token = interaction.options.getString("token");
    const config = store.getUserConfig(userId);
    config.autoLoginToken = token;
    config.autoLoginEnabled = true;
    store.setUserConfig(userId, config);

    startAutoLogin(userId, token, config.autoLoginChannel, client);
    const isActive = isAutoLoginActive(userId);

    // ── Status container ───────────────────────────────────────────────────────
    // Component count:
    //   Container(1) + MediaGallery(1) + Item(1) + Sep(1)
    //   + Section(1) + 3×TD(3) + Thumb(1)               = 9
    //   ActionRow(1) + 2×Button(2)                       = 3
    //                                             total  = 12 ✓
    const container = new ContainerBuilder()
      .setAccentColor(isActive ? 0x57f287 : 0xed4245)
      .addMediaGalleryComponents(botBanner(client))
      .addSeparatorComponents(sep())
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              isActive
                ? "🟢 **Auto-Login Activated**"
                : "🔴 **Auto-Login Failed to Start**",
            ),
            new TextDisplayBuilder().setContent(
              `👁️ **Watch Channel:** <#${config.autoLoginChannel}>`,
            ),
            new TextDisplayBuilder().setContent(
              isActive
                ? "Monitoring for **Authenticate** / **Log Me In** buttons…"
                : "Could not start the worker. Please verify your token is valid and try again.",
            ),
          )
          .setThumbnailAccessory(botThumb(client)),
      );

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ap_al_toggle")
        .setLabel(isActive ? "Stop Auto-Login" : "Start Auto-Login")
        .setStyle(isActive ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("ap_al_set_channel")
        .setLabel("Change Watch Channel")
        .setStyle(ButtonStyle.Primary),
    );

    await interaction.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [container, actionRow],
    });
  },
};
