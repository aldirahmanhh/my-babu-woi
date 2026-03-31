const {
  MessageFlags,
  TextDisplayBuilder,
  ContainerBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = require("discord.js");
const { buildPanel } = require("../../utils/autopost-builder");
const store = require("../../utils/autopost-store");
const cfg = require("../../config/config.json");

function getImage(key) {
  const custom = cfg.images && cfg.images[key];
  return custom && custom.trim() !== "" ? custom.trim() : null;
}

module.exports = {
  name: "autopost",
  aliases: ["ap"],
  description: "Open the AutoPost management panel",
  usage: "autopost",

  async run(client, message) {
    if (!message.guild) return message.reply("Hanya bisa digunakan di server.");

    const userId = message.author.id;
    const channelId = message.channel.id;

    // Main panel — 31 components
    const { container } = buildPanel(userId, client);

    const room = store.getUserRoom(userId);
    const inPrivateRoom = room && room.channelId === channelId;

    if (inPrivateRoom) {
      const bannerURL = getImage("welcomeBanner") || client.user.displayAvatarURL({ extension: "png", size: 512 });
      const thumbURL = getImage("welcomeThumbnail") || client.user.displayAvatarURL({ extension: "png", size: 512 });

      const thumbnail = new ThumbnailBuilder({ media: { url: thumbURL } });

      // Banner — MediaGallery(1) + MediaGalleryItem(1) = 2 components
      const banner = new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(bannerURL),
      );

      // Greeting section — Section(1) + 2×TextDisplay(2) + Thumbnail(1) = 4 components
      const welcomeSection = new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `👋 **Welcome back, <@${userId}>!**`,
          ),
          new TextDisplayBuilder().setContent(
            "Your private AutoPost room is ready. Use the panel below to manage your channels, token, and Auto-Login settings.",
          ),
        )
        .setThumbnailAccessory(thumbnail);

      // welcomeContainer total: Container(1) + Banner(2) + Separator(1) + Section(4) = 8
      // Combined with main panel: 8 + 31 = 39 ✓ (under Discord's limit of 40)
      const welcomeContainer = new ContainerBuilder()
        .setAccentColor(0x5865f2)
        .addMediaGalleryComponents(banner)
        .addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(SeparatorSpacingSize.Small),
        )
        .addSectionComponents(welcomeSection);

      await message.reply({
        flags: MessageFlags.IsComponentsV2,
        components: [welcomeContainer, container],
      });
    } else {
      await message.reply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [container],
      });
    }
  },
};
