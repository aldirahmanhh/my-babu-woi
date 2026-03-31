/**
 * src/slashCommands/AutoPost/autopost-panel.js
 *
 * Command: /autopanel
 * Access : Server Owner only
 *
 * Deploys a public V2 panel in the current channel that allows any server member
 * to create their own private AutoPost & Auto-Login management room.
 *
 * When a member clicks the "Create Private Room" button, the bot:
 *   1. Creates a private text channel (visible only to that user + the bot).
 *   2. Sends the full AutoPost management panel inside the new room automatically.
 *   3. Sends an ephemeral confirmation to the user.
 *
 * The button handler (ap_public_create_room) lives in
 * src/handlers/autopost-interactions.js.
 */

const {
  SlashCommandBuilder,
  MessageFlags,
  TextDisplayBuilder,
  ContainerBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const cfg = require("../../config/config.json");

// ─── Visual helpers ───────────────────────────────────────────────────────────

/** Fresh thin-divider separator each call (builders are stateful objects). */
const sep = () =>
  new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);

/**
 * Small bot-avatar thumbnail.
 * @param {import('discord.js').Client} client
 * @param {128|256|512} [size=128]
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
 * Single-image MediaGallery banner using the bot's avatar.
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

/**
 * Builds a compact single-section container (5 components).
 * Useful for simple ephemeral feedback replies.
 *
 * @param {import('discord.js').Client} client
 * @param {number}  color  Accent hex color
 * @param {string}  title  Bold first line
 * @param {string}  body   Second line
 */
function buildSimpleContainer(client, color, title, body) {
  return new ContainerBuilder()
    .setAccentColor(color)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(title),
          new TextDisplayBuilder().setContent(body),
        )
        .setThumbnailAccessory(botThumb(client)),
    );
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName("autopanel")
    .setDescription("[Owner] Deploy the public AutoPost room-creation panel"),

  /**
   * @param {import('discord.js').Client}                      client
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  run: async (client, interaction) => {
    // ── Owner-only guard ───────────────────────────────────────────────────
    if (interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [
          buildSimpleContainer(
            client,
            0xed4245,
            "❌ **Owner Only**",
            "Only the server owner can deploy the public AutoPost panel.",
          ),
        ],
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const bannerURL = cfg.images && cfg.images.panelBanner && cfg.images.panelBanner.trim() !== ""
        ? cfg.images.panelBanner.trim()
        : client.user.displayAvatarURL({ extension: "png", size: 512 });
      const thumbURL = cfg.images && cfg.images.panelThumbnail && cfg.images.panelThumbnail.trim() !== ""
        ? cfg.images.panelThumbnail.trim()
        : client.user.displayAvatarURL({ extension: "png", size: 512 });

      // ── Build the public panel (posted in the channel) ─────────────────
      //
      // Component count:
      //   Container(1) + MediaGallery(1)+Item(1) + Sep(1)
      //   + Section(1)+TD(1)+TD(1)+TD(1)+Thumb(1) + Sep(1) + TD(1)
      //   = 11  (container components)
      //   ActionRow(1) + Button(1) = 2
      //   Grand total = 13  ✓
      //
      const publicContainer = new ContainerBuilder()
        .setAccentColor(0x5865f2)
        .addMediaGalleryComponents(botBanner(client))
        .addSeparatorComponents(sep())
        .addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                "🏠 **AutoPost Private Rooms**",
              ),
              new TextDisplayBuilder().setContent(
                "Create your own private AutoPost & Auto-Login management room. " +
                  "Only you and the bot can see inside.",
              ),
              new TextDisplayBuilder().setContent(
                "🔧 Manage channels, intervals, tokens, and auto-login — all in one place.",
              ),
            )
            .setThumbnailAccessory(
              new ThumbnailBuilder({ media: { url: thumbURL } }),
            ),
        )
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "👇 Click the button below to create your private room.",
          ),
        );

      // Persistent button — any server member can click this
      const publicRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ap_public_create_room")
          .setLabel("🔒 Create Private Room")
          .setStyle(ButtonStyle.Success),
      );

      // ── Post the public panel ──────────────────────────────────────────
      await interaction.channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [publicContainer, publicRow],
      });

      // ── Success reply to owner ─────────────────────────────────────────
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [
          buildSimpleContainer(
            client,
            0x57f287,
            "✅ **Public Panel Deployed**",
            "The AutoPost room-creation panel is now visible in this channel.",
          ),
        ],
      });
    } catch (err) {
      console.error("[AUTOPANEL] Error:", err);

      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [
          buildSimpleContainer(
            client,
            0xed4245,
            "❌ **Deployment Failed**",
            `An error occurred: ${err.message}`,
          ),
        ],
      });
    }
  },
};
