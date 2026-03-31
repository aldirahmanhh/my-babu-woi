/**
 * src/handlers/ticket-interactions.js
 *
 * Handles every ticket-related Discord interaction:
 *
 *  Buttons
 *   ticket_create  → show the "create ticket" modal
 *   ticket_close   → close & delete the ticket channel, credit handler ranking
 *   ticket_claim   → let a handler claim the ticket
 *   ticket_rename  → show the "rename channel" modal
 *
 *  Modal Submits
 *   ticket_modal_create  → create the private ticket channel + welcome message
 *   ticket_modal_rename  → rename the existing ticket channel
 *
 * Routing is done by interactionCreate.js, which calls
 *   ticketHandler.execute(client, interaction)
 * for every interaction whose customId starts with "ticket_".
 */

'use strict';

const {
  MessageFlags,
  PermissionFlagsBits,
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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const { readJSON, readJSONOrDefault, writeJSON } = require('../utils/dataManager');
const { getNextMondayWIB }                        = require('../utils/weeklyReset');
const cfg                                         = require('../config/config.json');

// ─── Visual helpers ───────────────────────────────────────────────────────────

/** New thin-divider separator instance each call (builders are stateful). */
const sep = () =>
  new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

/**
 * Small bot-avatar thumbnail.
 * @param {import('discord.js').Client} client
 * @param {128|256|512} [size=128]
 */
function botThumb(client, size = 128) {
  const url = cfg.images && cfg.images.ticketThumbnail && cfg.images.ticketThumbnail.trim() !== ""
    ? cfg.images.ticketThumbnail.trim()
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
  const url = cfg.images && cfg.images.ticketBanner && cfg.images.ticketBanner.trim() !== ""
    ? cfg.images.ticketBanner.trim()
    : client.user.displayAvatarURL({ extension: 'png', size: 512 });
  return new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(url),
  );
}

/**
 * Builds a compact single-section container (5 components).
 * Useful for simple feedback replies.
 *
 * @param {import('discord.js').Client} client
 * @param {number}  color  Accent hex
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

/**
 * Smart ephemeral reply that works regardless of interaction state
 * (not replied, deferred, or already replied).
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} opts  discord.js reply options
 */
async function safeReply(interaction, opts) {
  try {
    if (interaction.replied) {
      await interaction.followUp(opts);
    } else if (interaction.deferred) {
      await interaction.editReply(opts);
    } else {
      await interaction.reply(opts);
    }
  } catch (err) {
    console.error('[TICKET] safeReply error:', err.message);
  }
}

/**
 * Ephemeral error reply using a V2 container.
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').Client} client
 * @param {string} title
 * @param {string} body
 */
async function replyError(interaction, client, title, body) {
  await safeReply(interaction, {
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    components: [buildSimpleContainer(client, 0xed4245, title, body)],
  });
}

/**
 * Ephemeral warning reply (yellow).
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').Client} client
 * @param {string} title
 * @param {string} body
 */
async function replyWarn(interaction, client, title, body) {
  await safeReply(interaction, {
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    components: [buildSimpleContainer(client, 0xfee75c, title, body)],
  });
}

// ─── Main entry point ─────────────────────────────────────────────────────────

module.exports = {
  /**
   * Called by interactionCreate.js for any customId starting with "ticket_".
   *
   * @param {import('discord.js').Client}      client
   * @param {import('discord.js').Interaction} interaction
   */
  async execute(client, interaction) {
    const { customId } = interaction;

    try {
      // ── Buttons ──────────────────────────────────────────────────────────
      if (interaction.isButton()) {
        if (customId === 'ticket_create') return await handleCreate(client, interaction);
        if (customId === 'ticket_close')  return await handleClose(client, interaction);
        if (customId === 'ticket_claim')  return await handleClaim(client, interaction);
        if (customId === 'ticket_rename') return await handleRename(client, interaction);
      }

      // ── Modal Submits ─────────────────────────────────────────────────────
      if (interaction.isModalSubmit()) {
        if (customId === 'ticket_modal_create') return await handleCreateModal(client, interaction);
        if (customId === 'ticket_modal_rename') return await handleRenameModal(client, interaction);
      }
    } catch (err) {
      console.error(`[TICKET] Unhandled error in "${customId}":`, err);
      await replyError(
        interaction, client,
        '❌ **Unexpected Error**',
        `Something went wrong: ${err.message}`,
      );
    }
  },
};

// ─── Button: ticket_create ────────────────────────────────────────────────────

/**
 * Shows the "Create Ticket" modal when a user clicks the panel button.
 */
async function handleCreate(client, interaction) {
  const modal = new ModalBuilder()
    .setCustomId('ticket_modal_create')
    .setTitle('Place an Order');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('ticket_subject')
        .setLabel('Service / Order')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('What service do you want to order?')
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('ticket_reason')
        .setLabel('Order Details')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Describe your order details, quantity, and any special requests…')
        .setRequired(true),
    ),
  );

  await interaction.showModal(modal);
}

// ─── Modal Submit: ticket_modal_create ───────────────────────────────────────

/**
 * Creates the private ticket channel and posts the welcome message.
 */
async function handleCreateModal(client, interaction) {
  const userId  = interaction.user.id;
  const guildId = interaction.guild.id;

  // Load per-guild config
  const config    = await readJSON('configTickets.json');
  const guildConf = config?.[guildId];

  if (!guildConf) {
    return replyWarn(
      interaction, client,
      '⚠️ **Not Configured**',
      'The ticket system has not been set up yet. Ask the server owner to run `/ticket setup`.',
    );
  }

  // Defer early — channel creation can take a moment
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const subject = interaction.fields.getTextInputValue('ticket_subject').trim();
  const reason  = interaction.fields.getTextInputValue('ticket_reason').trim();

  // Check for an existing open ticket from this user in this guild
  const tickets       = await readJSONOrDefault('tickets.json', {});
  const existingEntry = Object.values(tickets).find(
    (t) => t.userId === userId && t.guildId === guildId && t.status === 'open',
  );

  if (existingEntry) {
    return safeReply(interaction, {
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildSimpleContainer(
          client,
          0xfee75c,
          '⚠️ **Ticket Already Open**',
          `You already have an open ticket: <#${existingEntry.channelId}>`,
        ),
      ],
    });
  }

  try {
    // ── Create the private channel ─────────────────────────────────────────
    const safeUsername = interaction.user.username
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
      .slice(0, 20) || userId;

    const ticketChannel = await interaction.guild.channels.create({
      name: `ticket-${safeUsername}`,
      type: 0, // GuildText
      parent: guildConf.categoryId,
      permissionOverwrites: [
        // @everyone — deny view
        {
          id: interaction.guild.roles.everyone,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        // Ticket creator — read + write
        {
          id: userId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        // Handler role — read + write
        {
          id: guildConf.handlerRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        // Bot itself — full access so it can manage/delete later
        {
          id: client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
          ],
        },
      ],
    });

    // ── Persist ticket record ──────────────────────────────────────────────
    const ticketId = ticketChannel.id; // channel ID doubles as unique key

    tickets[ticketId] = {
      id:              ticketId,
      channelId:       ticketChannel.id,
      guildId,
      userId,
      username:        interaction.user.tag,
      subject,
      reason,
      handlerId:       null,
      handlerUsername: null,
      status:          'open',
      createdAt:       new Date().toISOString(),
      claimedAt:       null,
      closedAt:        null,
    };

    await writeJSON('tickets.json', tickets);

    console.log(
      `[TICKET] #${ticketChannel.name} created by ${interaction.user.tag} (${userId})`,
    );

    // ── Send welcome message inside the ticket channel ─────────────────────
    //
    // Component count:
    //   Container(1) + MediaGallery(1)+Item(1) + Sep(1)
    //   + Section(1)+TD(1)+TD(1)+TD(1)+Thumb(1) + Sep(1) + TD(1)
    //   = 11  (container)
    //   ActionRow(1) + 3×Button(3) = 4
    //   Grand total = 15  ✓
    //

    // Check if user is handler or owner for rename button visibility
    const isHandlerOrOwner = guildConf.handlerRoleId &&
      (interaction.guild.roles.cache.get(guildConf.handlerRoleId)?.members.has(userId) ||
       userId === interaction.guild.ownerId);

    const welcomeContainer = new ContainerBuilder()
      .setAccentColor(0x5865f2)
      .addMediaGalleryComponents(botBanner(client))
      .addSeparatorComponents(sep())
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`🛍️ **Order — ${subject}**`),
            new TextDisplayBuilder().setContent(`Ordered by <@${userId}>`),
            new TextDisplayBuilder().setContent(`📝 *${reason}*`),
          )
          .setThumbnailAccessory(botThumb(client, 512)),
      )
      .addSeparatorComponents(sep())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          isHandlerOrOwner
            ? 'Use the buttons below to manage this order.'
            : 'Our team will review your order shortly.',
        ),
      );

    const ticketRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('🔒 Close Order')
        .setStyle(ButtonStyle.Danger),
    );

    if (isHandlerOrOwner) {
      ticketRow.addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_claim')
          .setLabel('👤 Claim Order')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('ticket_rename')
          .setLabel('📌 Rename Ticket')
          .setStyle(ButtonStyle.Secondary),
      );
    }

    await ticketChannel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [welcomeContainer, ticketRow],
    });

    // ── Confirm to the user ────────────────────────────────────────────────
    await safeReply(interaction, {
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildSimpleContainer(
          client,
          0x57f287,
          '✅ **Ticket Created**',
          `Your private ticket is ready: ${ticketChannel}`,
        ),
      ],
    });

  } catch (err) {
    console.error('[TICKET CREATE MODAL] Error:', err);
    await replyError(
      interaction, client,
      '❌ **Failed to Create Ticket**',
      `An error occurred while creating your ticket: ${err.message}`,
    );
  }
}

// ─── Button: ticket_claim ─────────────────────────────────────────────────────

/**
 * Lets a member with the handler role (or the owner) claim a ticket.
 * Stores the handler info in tickets.json and replies in-channel.
 */
async function handleClaim(client, interaction) {
  const channelId = interaction.channelId;
  const userId    = interaction.user.id;

  // Load guild config
  const config    = await readJSON('configTickets.json');
  const guildConf = config?.[interaction.guild.id];

  if (!guildConf) {
    return replyError(
      interaction, client,
      '❌ **System Error**',
      'Ticket system is not configured for this server.',
    );
  }

  // ── Check if caller has the handler role or is the owner ─────────────────
  const isOwner = userId === interaction.guild.ownerId;
  let   isHandler = false;

  if (!isOwner && guildConf.handlerRoleId) {
    const member = await interaction.guild.members.fetch(userId);
    isHandler = member.roles.cache.has(guildConf.handlerRoleId);
  }

  if (!isOwner && !isHandler) {
    return replyError(
      interaction, client,
      '❌ **Handler Only**',
      'Only members with the Handler role can claim tickets.',
    );
  }

  // ── Validate ticket state ─────────────────────────────────────────────────
  const tickets = await readJSONOrDefault('tickets.json', {});
  const ticket  = tickets[channelId];

  if (!ticket) {
    return replyError(
      interaction, client,
      '❌ **Ticket Not Found**',
      'Could not find a ticket record for this channel.',
    );
  }

  if (ticket.status !== 'open') {
    return replyError(
      interaction, client,
      '❌ **Ticket Closed**',
      'This ticket has already been closed.',
    );
  }

  if (ticket.handlerId) {
    return replyWarn(
      interaction, client,
      '⚠️ **Already Claimed**',
      `This ticket is already being handled by <@${ticket.handlerId}>.`,
    );
  }

  // ── Update record ─────────────────────────────────────────────────────────
  ticket.handlerId       = userId;
  ticket.handlerUsername = interaction.user.tag;
  ticket.claimedAt       = new Date().toISOString();

  await writeJSON('tickets.json', tickets);

  console.log(
    `[TICKET] #${interaction.channel.name} claimed by ${interaction.user.tag}`,
  );

  // ── Reply in the ticket channel (visible to everyone in it) ───────────────
  //
  // Component count: Container(1) + Section(1)+TD(1)+TD(1)+Thumb(1) = 5  ✓
  //
  await interaction.reply({
    flags: MessageFlags.IsComponentsV2,
    components: [
      buildSimpleContainer(
        client,
        0x57f287,
        '👤 **Ticket Claimed**',
        `This ticket is now being handled by <@${userId}> ✅`,
      ),
    ],
  });
}

// ─── Button: ticket_close ─────────────────────────────────────────────────────

/**
 * Closes a ticket:
 *  1. Marks the ticket as closed in tickets.json.
 *  2. Credits +1 totalJobs / weeklyJobs to the claiming handler in handlersRanking.json.
 *  3. Notifies the channel, then deletes it after a short delay.
 *
 * Allowed by: ticket creator, any handler, server owner.
 */
async function handleClose(client, interaction) {
  const channelId = interaction.channelId;
  const userId    = interaction.user.id;

  // Load data
  const config    = await readJSON('configTickets.json');
  const guildConf = config?.[interaction.guild.id];
  const tickets   = await readJSONOrDefault('tickets.json', {});
  const ticket    = tickets[channelId];

  if (!ticket) {
    return replyError(
      interaction, client,
      '❌ **Ticket Not Found**',
      'Could not find a ticket record for this channel.',
    );
  }

  if (ticket.status !== 'open') {
    return replyError(
      interaction, client,
      '❌ **Already Closed**',
      'This ticket has already been closed.',
    );
  }

  // ── Permission check ──────────────────────────────────────────────────────
  const isOwner   = userId === interaction.guild.ownerId;
  const isCreator = userId === ticket.userId;
  let   isHandler = false;

  if (!isOwner && guildConf?.handlerRoleId) {
    const member = await interaction.guild.members.fetch(userId);
    isHandler = member.roles.cache.has(guildConf.handlerRoleId);
  }

  if (!isOwner && !isCreator && !isHandler) {
    return replyError(
      interaction, client,
      '❌ **No Permission**',
      'Only the ticket creator, a handler, or the server owner can close this ticket.',
    );
  }

  // Defer so we have time for the ranking update + channel ops
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // ── Update ticket record ───────────────────────────────────────────────
    ticket.status   = 'closed';
    ticket.closedAt = new Date().toISOString();
    await writeJSON('tickets.json', tickets);

    // ── Credit the handler's ranking ───────────────────────────────────────
    if (ticket.handlerId) {
      const ranking = await readJSONOrDefault('handlersRanking.json', {});

      if (!ranking[ticket.handlerId]) {
        // First close for this handler — initialise their record
        ranking[ticket.handlerId] = {
          userId:      ticket.handlerId,
          username:    ticket.handlerUsername || ticket.handlerId,
          totalJobs:   0,
          weeklyJobs:  0,
          lastUpdated: new Date().toISOString(),
          weekResetAt: getNextMondayWIB().toISOString(),
        };
      }

      ranking[ticket.handlerId].totalJobs  += 1;
      ranking[ticket.handlerId].weeklyJobs += 1;
      ranking[ticket.handlerId].lastUpdated = new Date().toISOString();

      // Keep username up-to-date in case the user changed their tag
      if (ticket.handlerUsername) {
        ranking[ticket.handlerId].username = ticket.handlerUsername;
      }

      await writeJSON('handlersRanking.json', ranking);

      console.log(
        `[TICKET] +1 job for handler ${ticket.handlerUsername} ` +
        `(total: ${ranking[ticket.handlerId].totalJobs})`,
      );
    }

    console.log(
      `[TICKET] #${interaction.channel.name} closed by ${interaction.user.tag}`,
    );

    // ── Notify in-channel before deletion ─────────────────────────────────
    //
    // Component count: Container(1) + Section(1)+TD(1)+TD(1)+Thumb(1) = 5  ✓
    //
    await interaction.channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildSimpleContainer(
          client,
          0xed4245,
          '🔒 **Ticket Closed**',
          `Closed by <@${userId}>. This channel will be deleted in 5 seconds.`,
        ),
      ],
    });

    // ── Confirm to the closer ──────────────────────────────────────────────
    await safeReply(interaction, {
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildSimpleContainer(
          client,
          0x57f287,
          '✅ **Closing Ticket**',
          'The ticket has been recorded as closed. Channel deletes in 5 seconds.',
        ),
      ],
    });

    // ── Delete channel after a short delay ────────────────────────────────
    setTimeout(async () => {
      try {
        await interaction.channel.delete('Ticket closed');
      } catch (delErr) {
        console.error('[TICKET CLOSE] Channel delete error:', delErr.message);
      }
    }, 5_000);

  } catch (err) {
    console.error('[TICKET CLOSE] Error:', err);
    await replyError(
      interaction, client,
      '❌ **Error Closing Ticket**',
      `Something went wrong: ${err.message}`,
    );
  }
}

// ─── Button: ticket_rename ────────────────────────────────────────────────────

/**
 * Shows the "rename channel" modal.
 * Allowed by: ticket creator, handler, server owner.
 */
async function handleRename(client, interaction) {
  const channelId = interaction.channelId;
  const userId    = interaction.user.id;

  const config    = await readJSON('configTickets.json');
  const guildConf = config?.[interaction.guild.id];
  const tickets   = await readJSONOrDefault('tickets.json', {});
  const ticket    = tickets[channelId];

  if (!ticket) {
    return replyError(
      interaction, client,
      '❌ **Ticket Not Found**',
      'Could not find a ticket record for this channel.',
    );
  }

  const isOwner   = userId === interaction.guild.ownerId;
  let   isHandler = false;

  if (!isOwner && guildConf?.handlerRoleId) {
    const member = await interaction.guild.members.fetch(userId);
    isHandler = member.roles.cache.has(guildConf.handlerRoleId);
  }

  if (!isOwner && !isHandler) {
    return replyError(
      interaction, client,
      '❌ **No Permission**',
      'Only handlers and the server owner can rename this ticket.',
    );
  }

  const modal = new ModalBuilder()
    .setCustomId('ticket_modal_rename')
    .setTitle('Rename Ticket Channel');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('ticket_new_name')
        .setLabel('New Channel Name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. billing-issue')
        .setRequired(true)
        .setMaxLength(50),
    ),
  );

  await interaction.showModal(modal);
}

// ─── Modal Submit: ticket_modal_rename ───────────────────────────────────────

/**
 * Renames the ticket channel to the user-supplied name.
 * Performs the same permission check as the button handler.
 */
async function handleRenameModal(client, interaction) {
  const channelId = interaction.channelId;
  const userId    = interaction.user.id;

  const config    = await readJSON('configTickets.json');
  const guildConf = config?.[interaction.guild.id];
  const tickets   = await readJSONOrDefault('tickets.json', {});
  const ticket    = tickets[channelId];

  if (!ticket) {
    return replyError(
      interaction, client,
      '❌ **Ticket Not Found**',
      'Could not find a ticket record for this channel.',
    );
  }

  const isOwner   = userId === interaction.guild.ownerId;
  let   isHandler = false;

  if (!isOwner && guildConf?.handlerRoleId) {
    const member = await interaction.guild.members.fetch(userId);
    isHandler = member.roles.cache.has(guildConf.handlerRoleId);
  }

  if (!isOwner && !isHandler) {
    return replyError(
      interaction, client,
      '❌ **No Permission**',
      'Only handlers and the server owner can rename this ticket.',
    );
  }

  const rawName = interaction.fields.getTextInputValue('ticket_new_name');

  // Sanitise: lowercase, replace non-alphanumeric/dash chars with hyphens,
  // collapse consecutive hyphens, strip leading/trailing hyphens.
  const cleanName = rawName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  if (!cleanName) {
    return replyError(
      interaction, client,
      '❌ **Invalid Name**',
      'The name could not be sanitised into a valid channel name. Use letters, numbers, and hyphens only.',
    );
  }

  try {
    await interaction.channel.setName(
      cleanName,
      `Renamed by ${interaction.user.tag}`,
    );

    console.log(
      `[TICKET] Channel renamed to "${cleanName}" by ${interaction.user.tag}`,
    );

    // Component count: Container(1) + Section(1)+TD(1)+TD(1)+Thumb(1) = 5  ✓
    await interaction.reply({
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      components: [
        buildSimpleContainer(
          client,
          0x57f287,
          '📌 **Ticket Renamed**',
          `Channel name updated to **${cleanName}**.`,
        ),
      ],
    });
  } catch (err) {
    console.error('[TICKET RENAME] Error:', err);
    await replyError(
      interaction, client,
      '❌ **Rename Failed**',
      `Could not rename the channel: ${err.message}`,
    );
  }
}
