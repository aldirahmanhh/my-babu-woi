/**
 * src/events/client/interactionCreate.js
 *
 * Central interaction router for all slash commands and component interactions.
 *
 * Routing:
 *   - Slash commands  → client.slash map (loaded by handlers/slash.js)
 *   - ap_*  buttons/selects/modals → handlers/autopost-interactions.js or autopost-modals.js
 *   - ticket_* buttons/modals      → handlers/ticket-interactions.js
 *
 * Global permission check (slash commands only):
 *   ✅ Server owner        → always allowed
 *   ✅ Handler role member → allowed anywhere
 *   ✅ Any user            → allowed inside their own open ticket channel
 *   ❌ Otherwise           → blocked with an ephemeral error
 *   ℹ️  If the ticket system is not yet configured for this guild,
 *       the restriction is skipped entirely (no false positives on fresh setup).
 */

"use strict";

const {
  MessageFlags,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require("discord.js");

const config = require("../../config/config.json");
const { readJSON } = require("../../utils/dataManager");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a compact single-section ephemeral V2 container (5 components).
 * @param {import('discord.js').Client} client
 * @param {number}  color  Hex accent colour
 * @param {string}  title  Bold first line
 * @param {string}  body   Second line
 */
function buildSimpleContainer(client, color, title, body) {
  return new ContainerBuilder().setAccentColor(color).addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(title),
        new TextDisplayBuilder().setContent(body),
      )
      .setThumbnailAccessory(
        new ThumbnailBuilder({
          media: {
            url: client.user.displayAvatarURL({ extension: "png", size: 128 }),
          },
        }),
      ),
  );
}

// ─── Permission helper ────────────────────────────────────────────────────────

/**
 * Returns true if the interaction's user is allowed to run a slash command.
 *
 * Allowed when ANY of the following is true:
 *   1. User is the server owner.
 *   2. User has the configured handler role.
 *   3. The ticket system is not yet configured for this guild (no restrictions).
 *   4. The command is issued inside the user's own open ticket channel.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<boolean>}
 */
async function isAllowed(interaction) {
  // 1. Server owner is always allowed
  if (interaction.user.id === interaction.guild.ownerId) return true;

  try {
    // Load the ticket system config for this guild
    const ticketConfig = await readJSON("configTickets.json");
    const guildConf = ticketConfig?.[interaction.guild.id];

    // 3. Ticket system not configured → no restrictions apply
    if (!guildConf) return true;

    // 2. Handler role check
    if (guildConf.handlerRoleId) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (member.roles.cache.has(guildConf.handlerRoleId)) return true;
    }

    // 4. Regular user inside their own open ticket channel
    const tickets = await readJSON("tickets.json");
    if (tickets) {
      const inOwnTicket = Object.values(tickets).some(
        (t) =>
          t.channelId === interaction.channelId &&
          t.userId === interaction.user.id &&
          t.status === "open",
      );
      if (inOwnTicket) return true;
    }

    // None of the above — deny
    return false;
  } catch (err) {
    // On any unexpected read error, allow the command rather than
    // silently blocking legitimate users.
    console.error("[PERM CHECK] Error reading data files:", err.message);
    return true;
  }
}

// ─── Event module ─────────────────────────────────────────────────────────────

module.exports = {
  name: "interactionCreate",
  once: false,

  /**
   * @param {import('discord.js').Client}      client
   * @param {import('discord.js').Interaction} interaction
   */
  async execute(client, interaction) {
    try {
      // ── Slash commands ─────────────────────────────────────────────────────
      if (interaction.isChatInputCommand()) {
        // Block usage in DMs
        if (!interaction.guild) {
          const accentColor =
            parseInt(config.color.replace("#", ""), 16) || 0x5865f2;
          return interaction.reply({
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            components: [
              new ContainerBuilder()
                .setAccentColor(accentColor)
                .addTextDisplayComponents(
                  new TextDisplayBuilder().setContent(
                    "❌ This command can only be used inside a server.",
                  ),
                ),
            ],
          });
        }

        // Global permission check:
        // Regular users may only run commands inside their own open ticket channel.
        const allowed = await isAllowed(interaction);

        if (!allowed) {
          return interaction.reply({
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            components: [
              buildSimpleContainer(
                client,
                0xed4245,
                "🔒 **Restricted**",
                "You can only use this command inside a ticket room.",
              ),
            ],
          });
        }

        // Dispatch to the registered slash command module
        const command = client.slash.get(interaction.commandName);
        if (!command) return;

        await command.run(client, interaction, interaction.options);
        return;
      }

      // ── Button / String-select / Channel-select interactions ───────────────
      if (
        interaction.isButton() ||
        interaction.isStringSelectMenu() ||
        interaction.isChannelSelectMenu()
      ) {
        const { customId } = interaction;

        // AutoPost panel interactions
        if (customId.startsWith("ap_")) {
          const autopostHandler = require("../../handlers/autopost-interactions");
          await autopostHandler.execute(client, interaction);
          return;
        }

        // Ticket system interactions
        if (customId.startsWith("ticket_")) {
          const ticketHandler = require("../../handlers/ticket-interactions");
          await ticketHandler.execute(client, interaction);
          return;
        }
      }

      // ── Modal submits ──────────────────────────────────────────────────────
      if (interaction.isModalSubmit()) {
        const { customId } = interaction;

        // AutoPost modals
        if (customId.startsWith("ap_")) {
          const modalHandler = require("../../handlers/autopost-modals");
          await modalHandler.execute(client, interaction);
          return;
        }

        // Ticket modals
        if (customId.startsWith("ticket_")) {
          const ticketHandler = require("../../handlers/ticket-interactions");
          await ticketHandler.execute(client, interaction);
          return;
        }
      }
    } catch (err) {
      console.error("[INTERACTION ERROR]", err);

      // Last-resort error reply — only if we haven't replied yet
      if (
        interaction.isRepliable() &&
        !interaction.replied &&
        !interaction.deferred
      ) {
        interaction
          .reply({
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            components: [
              new ContainerBuilder()
                .setAccentColor(0xed4245)
                .addTextDisplayComponents(
                  new TextDisplayBuilder().setContent(
                    "⚠️ An unexpected error occurred while handling this interaction.",
                  ),
                ),
            ],
          })
          .catch(console.error);
      }
    }
  },
};
