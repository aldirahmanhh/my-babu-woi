/**
 * settoken.js
 * /settoken type:<shared|autopost|autologin> token:<string>
 *
 * Owner-only command that stores a Discord user token into userTokens.json.
 * Three slots are supported:
 *   • shared    → used by both AutoPost and Auto-Login when no custom token is set
 *   • autopost  → overrides shared for the AutoPost feature only
 *   • autologin → overrides shared for the Auto-Login feature only
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
} = require('discord.js');

const { readJSONOrDefault, writeJSON } = require('../../utils/dataManager');

// ─── Default token store shape ────────────────────────────────────────────────

const DEFAULT_TOKENS = {
  sharedToken: '',
  customTokens: {
    autopostToken: '',
    autoLoginToken: '',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sep = () =>
  new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

/**
 * Builds a small ephemeral V2 reply container.
 * @param {import('discord.js').Client} client
 * @param {number}  color  Accent hex color
 * @param {string}  title  Bold first line
 * @param {string}  body   Second line
 */
function buildReply(client, color, title, body) {
  const thumb = new ThumbnailBuilder({
    media: { url: client.user.displayAvatarURL({ extension: 'png', size: 128 }) },
  });

  return new ContainerBuilder()
    .setAccentColor(color)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(title),
          new TextDisplayBuilder().setContent(body),
        )
        .setThumbnailAccessory(thumb),
    );
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settoken')
    .setDescription('[Owner] Set a user token for AutoPost or Auto-Login')
    .addStringOption(opt =>
      opt
        .setName('type')
        .setDescription('Which token slot to update')
        .setRequired(true)
        .addChoices(
          { name: '🔗 Shared  (used by both features)', value: 'shared'    },
          { name: '📤 AutoPost only',                   value: 'autopost'  },
          { name: '🔑 Auto-Login only',                 value: 'autologin' },
        ),
    )
    .addStringOption(opt =>
      opt
        .setName('token')
        .setDescription('The Discord user token to store')
        .setRequired(true),
    ),

  /**
   * @param {import('discord.js').Client}                    client
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  run: async (client, interaction) => {

    // ── Owner-only guard ───────────────────────────────────────────────────
    if (interaction.user.id !== interaction.guild.ownerId) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [
          buildReply(
            client,
            0xED4245,
            '❌ **Owner Only**',
            'Only the server owner can manage stored tokens.',
          ),
        ],
      });
    }

    const type  = interaction.options.getString('type');
    const token = interaction.options.getString('token').trim();

    if (!token) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [
          buildReply(client, 0xED4245, '❌ **Empty Token**', 'The token cannot be blank.'),
        ],
      });
    }

    try {
      // ── Load current data (or initialise defaults) ─────────────────────
      const data = await readJSONOrDefault('userTokens.json', DEFAULT_TOKENS);

      // Ensure nested object exists after a potential partial read
      if (!data.customTokens) data.customTokens = { autopostToken: '', autoLoginToken: '' };

      // ── Write to the correct slot ──────────────────────────────────────
      let slotLabel = '';

      if (type === 'shared') {
        data.sharedToken = token;
        slotLabel = '🔗 Shared';
      } else if (type === 'autopost') {
        data.customTokens.autopostToken = token;
        slotLabel = '📤 AutoPost';
      } else if (type === 'autologin') {
        data.customTokens.autoLoginToken = token;
        slotLabel = '🔑 Auto-Login';
      }

      await writeJSON('userTokens.json', data);

      console.log(
        `[SETTOKEN] "${slotLabel}" token updated by ${interaction.user.tag} ` +
        `(ends …${token.slice(-6)})`
      );

      // ── Success reply ──────────────────────────────────────────────────
      // Component count:  Container(1) + Sep(1) + Section(1+2+1) = 6  ✓
      const thumb = new ThumbnailBuilder({
        media: { url: client.user.displayAvatarURL({ extension: 'png', size: 128 }) },
      });

      await interaction.reply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [
          new ContainerBuilder()
            .setAccentColor(0x57F287)
            .addSectionComponents(
              new SectionBuilder()
                .addTextDisplayComponents(
                  new TextDisplayBuilder().setContent(`✅ **${slotLabel} Token Saved**`),
                  new TextDisplayBuilder().setContent(
                    `Token ending in \`…${token.slice(-6)}\` has been stored successfully.`,
                  ),
                )
                .setThumbnailAccessory(thumb),
            ),
        ],
      });

    } catch (err) {
      console.error('[SETTOKEN] Unexpected error:', err);

      // Guard: only reply if we haven't already
      const replyFn = interaction.replied || interaction.deferred
        ? interaction.followUp.bind(interaction)
        : interaction.reply.bind(interaction);

      await replyFn({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [
          buildReply(
            client,
            0xED4245,
            '❌ **Error Saving Token**',
            `Something went wrong: ${err.message}`,
          ),
        ],
      });
    }
  },
};
