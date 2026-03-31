/**
 * src/slashCommands/Utility/autopost.js
 *
 * /autopost token:<string> channel:<channel>
 *
 * Owner-only command that:
 *  1. Sends a rich V2 embed + plain-text copy of the token to the target channel.
 *  2. Logs the action to src/data/tokenLogs.json.
 *
 * NOTE: This command shares the name "autopost" with the panel command in
 *       src/slashCommands/AutoPost/autopost-panel.js.  Because the slash
 *       handler loads directories alphabetically (AutoPost → Utility), THIS
 *       file loads last and wins.  The panel is still reachable via the
 *       message command `autopost` / `ap`.
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
  ChannelType,
} = require('discord.js');
const cfg = require('../../config/config.json');
const { readJSONOrDefault, writeJSON } = require('../../utils/dataManager');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** New thin-divider separator instance each call (builders are stateful). */
const sep = () =>
  new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

/**
 * Small bot-avatar thumbnail.
 * @param {import('discord.js').Client} client
 * @param {number} [size=128]
 */
function botThumb(client, size = 128) {
  const url = cfg.images && cfg.images.panelThumbnail && cfg.images.panelThumbnail.trim() !== ""
    ? cfg.images.panelThumbnail.trim()
    : client.user.displayAvatarURL({ extension: 'png', size });
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
    : client.user.displayAvatarURL({ extension: 'png', size: 512 });
  return new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(url),
  );
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autopost')
    .setDescription('[Owner] Post a user token to a channel and log the action')
    .addStringOption((opt) =>
      opt
        .setName('token')
        .setDescription('The Discord user token to post')
        .setRequired(true),
    )
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Channel to send the token to')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText),
    ),

  /**
   * @param {import('discord.js').Client} client
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  run: async (client, interaction) => {
    // ── Owner-only guard ─────────────────────────────────────────────────────
    if (interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [
          new ContainerBuilder()
            .setAccentColor(0xed4245)
            .addSectionComponents(
              new SectionBuilder()
                .addTextDisplayComponents(
                  new TextDisplayBuilder().setContent('❌ **Owner Only**'),
                  new TextDisplayBuilder().setContent(
                    'This command can only be used by the server owner.',
                  ),
                )
                .setThumbnailAccessory(botThumb(client)),
            ),
        ],
      });
    }

    const token         = interaction.options.getString('token').trim();
    const targetChannel = interaction.options.getChannel('channel');
    const thumbURL = cfg.images && cfg.images.panelThumbnail && cfg.images.panelThumbnail.trim() !== ""
      ? cfg.images.panelThumbnail.trim()
      : client.user.displayAvatarURL({ extension: 'png', size: 512 });

    try {
      // ── Build rich V2 embed ──────────────────────────────────────────────
      //
      // Component count (inside container):
      //   MediaGallery(1) + Item(1) + Sep(1)
      //   + Section(1) + 2×TD(2) + Thumb(1)
      //   + Sep(1) + TD(1)
      //   Container wrapper: 1
      //   Total: 10  ✓
      //
      const tokenEmbed = new ContainerBuilder()
        .setAccentColor(0x5865f2)
        .addMediaGalleryComponents(botBanner(client))
        .addSeparatorComponents(sep())
        .addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent('🔑 **User Token**'),
              new TextDisplayBuilder().setContent(
                'Posted by the server owner. Copy the token below:',
              ),
            )
            .setThumbnailAccessory(
              new ThumbnailBuilder({ media: { url: thumbURL } }),
            ),
        )
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(
          // Wrap in a code block so the token is easy to select & copy
          new TextDisplayBuilder().setContent(`\`\`\`\n${token}\n\`\`\``),
        );

      await targetChannel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [tokenEmbed],
      });

      // ── Plain-text fallback so the token can be copy-pasted even on mobile ─
      await targetChannel.send(token);

      // ── Log the action ───────────────────────────────────────────────────
      const logs = await readJSONOrDefault('tokenLogs.json', { logs: [] });
      logs.logs.push({
        timestamp:    new Date().toISOString(),
        userId:       interaction.user.id,
        username:     interaction.user.tag,
        channelId:    targetChannel.id,
        channelName:  targetChannel.name,
        // Store only a partial token in logs for safety
        tokenPreview: `${token.slice(0, 10)}…${token.slice(-4)}`,
      });
      await writeJSON('tokenLogs.json', logs);

      console.log(
        `[AUTOPOST] Token posted by ${interaction.user.tag} → #${targetChannel.name}`,
      );

      // ── Ephemeral confirmation ───────────────────────────────────────────
      return interaction.reply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [
          new ContainerBuilder()
            .setAccentColor(0x57f287)
            .addSectionComponents(
              new SectionBuilder()
                .addTextDisplayComponents(
                  new TextDisplayBuilder().setContent('✅ **Token Posted**'),
                  new TextDisplayBuilder().setContent(
                    `Token sent to ${targetChannel} and logged successfully.`,
                  ),
                )
                .setThumbnailAccessory(botThumb(client)),
            ),
        ],
      });
    } catch (err) {
      console.error('[AUTOPOST] Error:', err);

      const replyOpts = {
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [
          new ContainerBuilder()
            .setAccentColor(0xed4245)
            .addSectionComponents(
              new SectionBuilder()
                .addTextDisplayComponents(
                  new TextDisplayBuilder().setContent('❌ **Error**'),
                  new TextDisplayBuilder().setContent(
                    `Could not send the token: ${err.message}`,
                  ),
                )
                .setThumbnailAccessory(botThumb(client)),
            ),
        ],
      };

      return interaction.replied || interaction.deferred
        ? interaction.followUp(replyOpts)
        : interaction.reply(replyOpts);
    }
  },
};
