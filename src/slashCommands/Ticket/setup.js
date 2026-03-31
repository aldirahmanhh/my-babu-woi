/**
 * src/slashCommands/Ticket/setup.js
 *
 * Command: /ticket setup channel:<channel> category:<category> handler_role:<role>
 *
 * Server-owner-only command that:
 *  1. Validates the caller is the guild owner.
 *  2. Sends a persistent ticket panel (V2 embed + button) to the chosen channel.
 *  3. Saves the guild config to src/data/configTickets.json.
 *
 * The "Create New Ticket" button (customId: ticket_create) is handled by
 * src/handlers/ticket-interactions.js, routed from interactionCreate.js.
 */

const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require("discord.js");

const { readJSONOrDefault, writeJSON } = require("../../utils/dataManager");
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
  const url = cfg.images && cfg.images.ticketThumbnail && cfg.images.ticketThumbnail.trim() !== ""
    ? cfg.images.ticketThumbnail.trim()
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
  const url = cfg.images && cfg.images.ticketBanner && cfg.images.ticketBanner.trim() !== ""
    ? cfg.images.ticketBanner.trim()
    : client.user.displayAvatarURL({ extension: "png", size: 512 });
  return new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(url),
  );
}

/**
 * Builds a small ephemeral error/success reply container (5 components).
 * @param {import('discord.js').Client} client
 * @param {number}  color   Accent hex color
 * @param {string}  title   Bold first line
 * @param {string}  body    Second line
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
    .setName("ticket")
    .setDescription("[Owner] Ticket system management")
    .addSubcommand((sub) =>
      sub
        .setName("setup")
        .setDescription("Deploy the ticket panel to a channel")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel where the ticket panel will be posted")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText),
        )
        .addChannelOption((opt) =>
          opt
            .setName("category")
            .setDescription("Category in which new ticket channels are created")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildCategory),
        )
        .addRoleOption((opt) =>
          opt
            .setName("handler_role")
            .setDescription("Role whose members can claim and close tickets")
            .setRequired(true),
        ),
    ),

  /**
   * @param {import('discord.js').Client}                      client
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  run: async (client, interaction) => {
    // ── Only the server owner may run this command ───────────────────────────
    if (interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [
          buildSimpleContainer(
            client,
            0xed4245,
            "❌ **Owner Only**",
            "Only the server owner can configure the ticket system.",
          ),
        ],
      });
    }

    const sub = interaction.options.getSubcommand();
    if (sub !== "setup") return; // future-proof for additional subcommands

    const panelChannel = interaction.options.getChannel("channel");
    const category = interaction.options.getChannel("category");
    const handlerRole = interaction.options.getRole("handler_role");

    // Defer so we have time to create the panel message and write JSON
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const bannerURL = cfg.images && cfg.images.ticketBanner && cfg.images.ticketBanner.trim() !== ""
        ? cfg.images.ticketBanner.trim()
        : client.user.displayAvatarURL({ extension: "png", size: 512 });
      const thumbURL = cfg.images && cfg.images.ticketThumbnail && cfg.images.ticketThumbnail.trim() !== ""
        ? cfg.images.ticketThumbnail.trim()
        : client.user.displayAvatarURL({ extension: "png", size: 512 });

      // ── Build ticket panel (sent to the chosen channel) ──────────────────
      //
      // Component count:
      //   Container(1) + MediaGallery(1)+Item(1) + Sep(1)
      //   + Section(1)+TD(1)+TD(1)+TD(1)+Thumb(1) + Sep(1) + TD(1)
      //   = 11  (container components)
      //   ActionRow(1) + Button(1) = 2
      //   Grand total = 13  ✓
      //
      const panelContainer = new ContainerBuilder()
        .setAccentColor(0x5865f2)
        .addMediaGalleryComponents(botBanner(client))
        .addSeparatorComponents(sep())
        .addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent("🛒 **Order Service**"),
              new TextDisplayBuilder().setContent(
                "Interested in our services? Open a private order ticket and our team will assist you.",
              ),
              new TextDisplayBuilder().setContent(
                `**Staff role:** <@&${handlerRole.id}>`,
              ),
            )
            .setThumbnailAccessory(
              new ThumbnailBuilder({ media: { url: thumbURL } }),
            ),
        )
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "👇 Click the button below to place your order.",
          ),
        );

      // Persistent button — no state encoded; handler reads config from JSON
      const panelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_create")
          .setLabel("🛍️ Place Order")
          .setStyle(ButtonStyle.Primary),
      );

      // ── Post panel ───────────────────────────────────────────────────────
      const panelMessage = await panelChannel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [panelContainer, panelRow],
      });

      // ── Persist config ───────────────────────────────────────────────────
      const config = await readJSONOrDefault("configTickets.json", {});
      config[interaction.guild.id] = {
        ticketChannelId: panelChannel.id,
        categoryId: category.id,
        handlerRoleId: handlerRole.id,
        panelMessageId: panelMessage.id,
        createdAt: new Date().toISOString(),
        createdBy: interaction.user.id,
      };
      await writeJSON("configTickets.json", config);

      console.log(
        `[TICKET SETUP] Guild ${interaction.guild.id} configured by ${interaction.user.tag}`,
      );

      // ── Success reply ────────────────────────────────────────────────────
      //
      // Component count:
      //   Container(1) + Section(1)+TD(1)+TD(1)+TD(1)+Thumb(1) = 6  ✓
      //
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [
          new ContainerBuilder()
            .setAccentColor(0x57f287)
            .addSectionComponents(
              new SectionBuilder()
                .addTextDisplayComponents(
                  new TextDisplayBuilder().setContent(
                    "✅ **Ticket System Ready**",
                  ),
                  new TextDisplayBuilder().setContent(
                    `Panel posted in ${panelChannel}.`,
                  ),
                  new TextDisplayBuilder().setContent(
                    `Category: **${category.name}**  ·  Handler: <@&${handlerRole.id}>`,
                  ),
                )
                .setThumbnailAccessory(botThumb(client)),
            ),
        ],
      });
    } catch (err) {
      console.error("[TICKET SETUP] Error:", err);

      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [
          buildSimpleContainer(
            client,
            0xed4245,
            "❌ **Setup Failed**",
            `An error occurred: ${err.message}`,
          ),
        ],
      });
    }
  },
};
