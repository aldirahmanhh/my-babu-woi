const {
    MessageFlags,
    TextDisplayBuilder,
    ContainerBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize
} = require('discord.js');
const store = require('../../utils/autopost-store');
const { isAutoLoginActive } = require('../../utils/autologin-worker');
const cfg = require('../../config/config.json');

module.exports = {
    name: 'autologin',
    aliases: ['al'],
    description: 'Configure Auto-Login (only in private rooms)',
    usage: 'autologin <token>',
    async run(client, message, args) {
        if (!message.guild) {
            return message.reply('This command can only be used in a server.');
        }

        const userId = message.author.id;
        const channelId = message.channel.id;

        const room = store.getUserRoom(userId);
        if (!room || room.channelId !== channelId) {
            return message.reply({
                flags: MessageFlags.IsComponentsV2,
                components: [
                    new ContainerBuilder()
                        .setAccentColor(0xe74c3c)
                        .addSectionComponents(
                            new SectionBuilder()
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent('❌ **Auto-Login can only be configured in your private room.**'),
                                    new TextDisplayBuilder().setContent('Use `autopost` → Create Private Room first.')
                                )
                        )
                ]
            });
        }

        const token = args.join(' ').trim();
        if (!token) {
            return message.reply({
                flags: MessageFlags.IsComponentsV2,
                components: [
                    new ContainerBuilder()
                        .setAccentColor(0xf39c12)
                        .addSectionComponents(
                            new SectionBuilder()
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent('⚠️ **Usage:** `autologin <token>`'),
                                    new TextDisplayBuilder().setContent('Provide your Discord user token to enable auto-login.')
                                )
                        )
                ]
            });
        }

        const config = store.getUserConfig(userId);
        config.autoLoginToken = token;
        config.autoLoginEnabled = true;
        store.setUserConfig(userId, config);

        const { startAutoLogin } = require('../../utils/autologin-worker');
        startAutoLogin(userId, token, config.autoLoginChannel, client);
        const isActive = isAutoLoginActive(userId);

        const thumbURL = cfg.images && cfg.images.autoLoginThumbnail && cfg.images.autoLoginThumbnail.trim() !== ""
            ? cfg.images.autoLoginThumbnail.trim()
            : client.user.displayAvatarURL({ extension: 'png', size: 128 });

        const statusSection = new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(isActive ? '🟢 **Auto-Login Activated**' : '🔴 **Auto-Login Failed**'),
                new TextDisplayBuilder().setContent(`Watch Channel: <#${config.autoLoginChannel}>`),
                new TextDisplayBuilder().setContent('Monitoring for Authenticate / Log Me In buttons...')
            )
            .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: thumbURL } }));

        const container = new ContainerBuilder()
            .setAccentColor(isActive ? 0x2ecc71 : 0xe74c3c)
            .addSectionComponents(statusSection);

        await message.reply({
            flags: MessageFlags.IsComponentsV2,
            components: [container]
        });
    }
};
