const {
  MessageFlags,
  TextDisplayBuilder,
  ContainerBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = require("discord.js");
const store = require("../utils/autopost-store");
const {
  buildPanel,
  buildAutoLoginPanel,
  startAutoPost,
  stopAutoPost,
  isAutoPostActive,
  formatInterval,
  buildRemoveChannelSelect,
  buildWelcomeContainer,
} = require("../utils/autopost-builder");
const {
  startAutoLogin,
  stopAutoLogin,
  isAutoLoginActive,
} = require("../utils/autologin-worker");
const cfg = require("../config/config.json");

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
    if (interaction.isButton()) {
      await handleButton(client, interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(client, interaction);
    } else if (interaction.isChannelSelectMenu()) {
      await handleChannelSelect(client, interaction);
    }
  },
};

// ─── Panel Refresh Helper ─────────────────────────────────────────────────────

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

// ─── Button Router ────────────────────────────────────────────────────────────

async function handleButton(client, interaction) {
  const { customId } = interaction;
  const userId = interaction.user.id;

  const handlers = {
    ap_set_token: handleSetToken,
    ap_create_room: handleCreateRoom,
    ap_public_create_room: handleCreateRoom,
    ap_add_channel: handleAddChannel,
    ap_toggle_post: handleTogglePost,
    ap_auto_login: handleAutoLogin,
    ap_remove_channel: handleRemoveChannel,
    ap_al_toggle: handleAutoLoginToggle,
    ap_al_set_channel: handleAutoLoginSetChannel,
    ap_back_to_panel: handleBackToPanel,
    ap_back_to_al: handleBackToAutoLogin,
    ap_close_room: handleCloseRoom,
  };

  const handler = handlers[customId];
  if (handler) await handler(client, interaction, userId);
}

// ─── Select Menu Handlers ─────────────────────────────────────────────────────

async function handleSelectMenu(client, interaction) {
  if (interaction.customId !== "ap_remove_select") return;

  const userId = interaction.user.id;
  const channelId = interaction.values[0];
  const removed = store.removeChannel(userId, channelId);

  const thumbnail = botThumb(client);
  const container = new ContainerBuilder()
    .setAccentColor(removed ? 0x57f287 : 0xed4245)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            removed ? "✅ **Channel Removed**" : "❌ **Channel Not Found**",
          ),
          new TextDisplayBuilder().setContent(
            removed
              ? `<#${channelId}> has been removed from AutoPost.`
              : `Could not find channel \`${channelId}\` in your config.`,
          ),
        )
        .setThumbnailAccessory(thumbnail),
    );

  await interaction.reply({
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    components: [container],
  });

  if (removed) await refreshUserPanel(client, userId);
}

async function handleChannelSelect(client, interaction) {
  if (interaction.customId !== "ap_al_channel_select") return;

  const userId = interaction.user.id;
  const channelId = interaction.values[0];
  const config = store.getUserConfig(userId);
  config.autoLoginChannel = channelId;
  store.setUserConfig(userId, config);

  const { container } = buildAutoLoginPanel(userId, client);

  await interaction.update({
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  });

  const thumbnail = botThumb(client);
  const confirmContainer = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent("✅ **Watch Channel Updated**"),
          new TextDisplayBuilder().setContent(
            `Auto-Login will now monitor <#${channelId}>.`,
          ),
        )
        .setThumbnailAccessory(thumbnail),
    );

  await interaction.followUp({
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    components: [confirmContainer],
  });
}

// ─── Button Handlers ──────────────────────────────────────────────────────────

async function handleSetToken(client, interaction, userId) {
  const modal = new ModalBuilder()
    .setCustomId("ap_set_token_modal")
    .setTitle("Set User Token");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("token_input")
        .setLabel("Discord User Token")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Paste your token here…")
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(200),
    ),
  );

  await interaction.showModal(modal);
}

async function handleCreateRoom(client, interaction, userId) {
  const room = store.getUserRoom(userId);
  if (room) {
    const thumbnail = botThumb(client);
    const container = new ContainerBuilder()
      .setAccentColor(0xfee75c)
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("⚠️ **Room Already Exists**"),
            new TextDisplayBuilder().setContent(
              "You already have a private room. Use `autopost` inside it to open the panel.",
            ),
          )
          .setThumbnailAccessory(thumbnail),
      );

    return interaction.reply({
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      components: [container],
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  const overwrites = [
    { id: guild.roles.everyone, deny: ["ViewChannel"] },
    {
      id: userId,
      allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"],
    },
    {
      id: client.user.id,
      allow: [
        "ViewChannel",
        "SendMessages",
        "ReadMessageHistory",
        "ManageChannels",
      ],
    },
  ];

  let category = guild.channels.cache.find(
    (c) => c.name === "🔒 AutoPost Rooms" && c.type === 4,
  );
  if (!category) {
    category = await guild.channels.create({
      name: "🔒 AutoPost Rooms",
      type: 4,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: ["ViewChannel"] },
      ],
    });
  }

  const channel = await guild.channels.create({
    name: `autopost-${interaction.user.username}`,
    type: 0,
    parent: category,
    permissionOverwrites: overwrites,
  });

  const roomId = `${userId}-${Date.now()}`;
  store.createPrivateRoom(userId, roomId, channel.id);

  const { container: welcomeContainer } = buildWelcomeContainer(
    client,
    interaction.user.id,
  );

  const { container: panelContainer } = buildPanel(userId, client);

  const sentMsg = await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [welcomeContainer, panelContainer],
  });

  store.setPanelMessageId(roomId, sentMsg.id);

  // Component count:
  //   Container(1) + MediaGallery(1) + Item(1) + Sep(1)
  //   + Section(1) + 3×TD(3) + Thumb(1) = 9
  //   ActionRow(1) + 2×Button(2) = 3  →  total 12 ✓
  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addMediaGalleryComponents(botBanner(client))
    .addSeparatorComponents(sep())
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent("🔒 **Private Room Created!**"),
          new TextDisplayBuilder().setContent(`Your room is ready: ${channel}`),
          new TextDisplayBuilder().setContent(
            "Type `autopost` inside it to open the full management panel.",
          ),
        )
        .setThumbnailAccessory(botThumb(client, 512)),
    );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Open Room")
      .setURL(channel.url)
      .setStyle(ButtonStyle.Link),
    new ButtonBuilder()
      .setCustomId("ap_close_room")
      .setLabel("Close Room")
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: [container, actionRow],
  });
}

async function handleAddChannel(client, interaction, userId) {
  const modal = new ModalBuilder()
    .setCustomId("ap_add_channel_modal")
    .setTitle("Add AutoPost Channel");

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("ch_id")
        .setLabel("Channel ID")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("123456789012345678")
        .setRequired(true)
        .setMinLength(17)
        .setMaxLength(25),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("ch_message")
        .setLabel("Message")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Message to auto-post…")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(1000),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("ch_hours")
        .setLabel("Hours")
        .setStyle(TextInputStyle.Short)
        .setValue("0")
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("ch_minutes")
        .setLabel("Minutes")
        .setStyle(TextInputStyle.Short)
        .setValue("5")
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("ch_seconds")
        .setLabel("Seconds")
        .setStyle(TextInputStyle.Short)
        .setValue("0")
        .setRequired(true),
    ),
  );

  await interaction.showModal(modal);
}

async function handleTogglePost(client, interaction, userId) {
  const config = store.getUserConfig(userId);
  const thumbnail = botThumb(client);

  if (!config.autoLoginToken) {
    const container = new ContainerBuilder()
      .setAccentColor(0xfee75c)
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("⚠️ **Token Required**"),
            new TextDisplayBuilder().setContent(
              "Please set your user token first using the **Set Token** button.",
            ),
          )
          .setThumbnailAccessory(thumbnail),
      );
    return interaction.reply({
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      components: [container],
    });
  }

  if (config.channels.length === 0) {
    const container = new ContainerBuilder()
      .setAccentColor(0xfee75c)
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              "⚠️ **No Channels Configured**",
            ),
            new TextDisplayBuilder().setContent(
              "Add at least one channel using the **Add** button before starting.",
            ),
          )
          .setThumbnailAccessory(thumbnail),
      );
    return interaction.reply({
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      components: [container],
    });
  }

  const wasRunning = isAutoPostActive(userId);
  if (wasRunning) {
    stopAutoPost(userId);
  } else {
    startAutoPost(userId);
  }

  await refreshUserPanel(client, userId);

  const container = new ContainerBuilder()
    .setAccentColor(wasRunning ? 0xed4245 : 0x57f287)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            wasRunning ? "⏹️ **AutoPost Stopped**" : "▶️ **AutoPost Started**",
          ),
          new TextDisplayBuilder().setContent(
            wasRunning
              ? "All posting jobs have been halted."
              : `Now posting to **${config.channels.length}** channel${config.channels.length !== 1 ? "s" : ""}.`,
          ),
        )
        .setThumbnailAccessory(thumbnail),
    );

  await interaction.reply({
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    components: [container],
  });
}

async function handleAutoLogin(client, interaction, userId) {
  const config = store.getUserConfig(userId);

  if (!config.autoLoginToken) {
    const thumbnail = botThumb(client);
    const container = new ContainerBuilder()
      .setAccentColor(0xfee75c)
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("⚠️ **Token Required**"),
            new TextDisplayBuilder().setContent(
              "Set your user token from the main panel before configuring Auto-Login.",
            ),
          )
          .setThumbnailAccessory(thumbnail),
      );
    return interaction.reply({
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      components: [container],
    });
  }

  const { container } = buildAutoLoginPanel(userId, client);
  await interaction.update({
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  });
}

async function handleRemoveChannel(client, interaction, userId) {
  const select = buildRemoveChannelSelect(userId);

  if (!select) {
    const thumbnail = botThumb(client);
    const container = new ContainerBuilder()
      .setAccentColor(0xfee75c)
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("⚠️ **No Channels to Remove**"),
            new TextDisplayBuilder().setContent(
              "You have no configured channels. Add one first.",
            ),
          )
          .setThumbnailAccessory(thumbnail),
      );
    return interaction.reply({
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      components: [container],
    });
  }

  // Component count:
  //   Container(1) + Section(1) + 2×TD(2) + Thumb(1) = 5
  //   ActionRow(1) + Select(1)                        = 2
  //                                              total = 7 ✓
  const container = new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent("🗑️ **Remove Channel**"),
          new TextDisplayBuilder().setContent(
            "Select a channel below to remove it from AutoPost:",
          ),
        )
        .setThumbnailAccessory(botThumb(client)),
    );

  await interaction.update({
    flags: MessageFlags.IsComponentsV2,
    components: [container, select],
  });
}

async function handleAutoLoginToggle(client, interaction, userId) {
  const config = store.getUserConfig(userId);
  config.autoLoginEnabled = !config.autoLoginEnabled;
  store.setUserConfig(userId, config);

  if (config.autoLoginEnabled && config.autoLoginToken) {
    startAutoLogin(
      userId,
      config.autoLoginToken,
      config.autoLoginChannel,
      client,
    );
  } else {
    stopAutoLogin(userId);
  }

  const { container } = buildAutoLoginPanel(userId, client);
  await interaction.update({
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  });

  const thumbnail = botThumb(client);
  const confirmContainer = new ContainerBuilder()
    .setAccentColor(config.autoLoginEnabled ? 0x57f287 : 0xed4245)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            config.autoLoginEnabled
              ? "🟢 **Auto-Login Enabled**"
              : "🔴 **Auto-Login Disabled**",
          ),
          new TextDisplayBuilder().setContent(
            config.autoLoginEnabled
              ? `Now monitoring <#${config.autoLoginChannel}> for login buttons.`
              : "Auto-Login has been turned off.",
          ),
        )
        .setThumbnailAccessory(thumbnail),
    );

  await interaction.followUp({
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    components: [confirmContainer],
  });
}

async function handleAutoLoginSetChannel(client, interaction, userId) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId("ap_al_channel_select")
    .setPlaceholder("Choose a channel to monitor…")
    .setChannelTypes([0]);

  const row = new ActionRowBuilder().addComponents(select);

  // Component count:
  //   Container(1) + Section(1) + 2×TD(2) + Thumb(1) = 5
  //   ActionRow(1) + ChannelSelect(1)                 = 2
  //                                             total  = 7 ✓
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent("👁️ **Set Watch Channel**"),
          new TextDisplayBuilder().setContent(
            "Choose the channel where Auto-Login will listen for **Authenticate** / **Log Me In** buttons:",
          ),
        )
        .setThumbnailAccessory(botThumb(client)),
    );

  await interaction.update({
    flags: MessageFlags.IsComponentsV2,
    components: [container, row],
  });
}

async function handleBackToPanel(client, interaction, userId) {
  const { container } = buildPanel(userId, client);
  await interaction.update({
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  });
}

async function handleBackToAutoLogin(client, interaction, userId) {
  const { container } = buildAutoLoginPanel(userId, client);
  await interaction.update({
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  });
}

async function handleCloseRoom(client, interaction, userId) {
  const room = store.getUserRoom(userId);
  if (!room) {
    const thumbnail = botThumb(client);
    const container = new ContainerBuilder()
      .setAccentColor(0xfee75c)
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("⚠️ **No Room Found**"),
            new TextDisplayBuilder().setContent(
              "You don't have an active private room.",
            ),
          )
          .setThumbnailAccessory(thumbnail),
      );
    return interaction.reply({
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      components: [container],
    });
  }

  try {
    const channel = await client.channels.fetch(room.channelId);
    if (channel) await channel.delete("Room closed by user");
  } catch (e) {
    console.error("[ROOM] Error deleting channel:", e.message);
  }

  store.deletePrivateRoom(room.roomId);

  // Component count:
  //   Container(1) + Section(1) + 2×TD(2) + Thumb(1) = 5 ✓
  await interaction.update({
    flags: MessageFlags.IsComponentsV2,
    components: [
      new ContainerBuilder()
        .setAccentColor(0xed4245)
        .addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent("🔒 **Private Room Closed**"),
              new TextDisplayBuilder().setContent(
                "Your room has been deleted. You can create a new one from the panel anytime.",
              ),
            )
            .setThumbnailAccessory(botThumb(client)),
        ),
    ],
  });
}
