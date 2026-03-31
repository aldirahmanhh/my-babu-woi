const { ActivityType, MessageFlags } = require('discord.js');
const store = require('../../utils/autopost-store');
const { buildWelcomeContainer, buildPanel } = require('../../utils/autopost-builder');

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        const tag = client.user.tag;
        const boxTitle = `BOT READY`;
        const boxMessage = `Logged in as ${tag}`;
        const maxLength = Math.max(boxTitle.length, boxMessage.length) + 4;
        console.log(`╔${'─'.repeat(maxLength)}╗`);
        console.log(`║ ${boxTitle.padEnd(maxLength - 2)} ║`);
        console.log(`╠${'─'.repeat(maxLength)}╣`);
        console.log(`║ ${boxMessage.padEnd(maxLength - 2)} ║`);
        console.log(`╚${'─'.repeat(maxLength)}╝`);

        client.user.setPresence({
            status: 'online',
            activities: [{
                name: `${client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0)} members`,
                type: ActivityType.Watching,
            }],
        });

        await refreshPrivateRoomPanels(client);
    },
};

async function refreshPrivateRoomPanels(client) {
    const rooms = store.loadStore ? store.loadStore().privateRooms : {};
    const roomEntries = Object.entries(rooms);

    if (roomEntries.length === 0) return;

    console.log(`[AUTO-REFRESH] Checking ${roomEntries.length} private room(s)...`);

    let refreshed = 0;
    let failed = 0;

    for (const [roomId, room] of roomEntries) {
        if (!room.panelMessageId || !room.channelId) continue;

        try {
            const channel = await client.channels.fetch(room.channelId).catch(() => null);
            if (!channel) {
                console.log(`[AUTO-REFRESH] Channel ${room.channelId} not found, skipping room ${roomId}`);
                failed++;
                continue;
            }

            const message = await channel.messages.fetch(room.panelMessageId).catch(() => null);
            if (!message) {
                console.log(`[AUTO-REFRESH] Panel message not found in ${channel.name}, skipping room ${roomId}`);
                failed++;
                continue;
            }

            const { container: welcomeContainer } = buildWelcomeContainer(client, room.userId);
            const { container: panelContainer } = buildPanel(room.userId, client);

            await message.edit({
                flags: MessageFlags.IsComponentsV2,
                components: [welcomeContainer, panelContainer],
            });

            console.log(`[AUTO-REFRESH] ✓ Refreshed panel in ${channel.name}`);
            refreshed++;
        } catch (err) {
            console.error(`[AUTO-REFRESH] ✗ Failed to refresh room ${roomId}: ${err.message}`);
            failed++;
        }
    }

    console.log(`[AUTO-REFRESH] Done: ${refreshed} refreshed, ${failed} failed`);
}
