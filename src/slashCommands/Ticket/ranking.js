/**
 * src/slashCommands/Ticket/ranking.js
 *
 * Command: /ranking [view:all|weekly]
 *
 * Shows the handler leaderboard.
 *   /ranking            → All-Time + Weekly (default)
 *   /ranking view:weekly → Weekly only
 *
 * Permissions:
 *   - Server owner  : allowed anywhere
 *   - Handler role  : allowed anywhere
 *   - Regular user  : only inside their own open ticket channel
 *     (enforced globally in interactionCreate.js)
 *
 * Side-effect on load: starts the hourly weekly-reset timer (once).
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
} = require('discord.js');

const { readJSONOrDefault }                      = require('../../utils/dataManager');
const { startWeeklyResetTimer, checkAndResetWeekly } = require('../../utils/weeklyReset');
const cfg                                        = require('../../config/config.json');
const fs                                         = require('fs');
const path                                       = require('path');

// Start the auto-reset timer the moment this module is first loaded (bot startup).
startWeeklyResetTimer();

// ─── Visual helpers ───────────────────────────────────────────────────────────

/** Thin divider (new instance each call to avoid reuse bugs). */
const sep = () =>
  new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

const MEDALS = ['🥇', '🥈', '🥉'];

function getBanner(client) {
  const url = cfg.images && cfg.images.ticketBanner && cfg.images.ticketBanner.trim() !== ""
    ? cfg.images.ticketBanner.trim()
    : client.user.displayAvatarURL({ extension: 'png', size: 512 });
  return url;
}

function getThumb(client) {
  const url = cfg.images && cfg.images.ticketThumbnail && cfg.images.ticketThumbnail.trim() !== ""
    ? cfg.images.ticketThumbnail.trim()
    : client.user.displayAvatarURL({ extension: 'png', size: 512 });
  return url;
}

/**
 * Builds a formatted leaderboard string ready for a TextDisplay.
 *
 * @param {Array<object>} sorted  Handlers sorted descending by the chosen field
 * @param {'totalJobs'|'weeklyJobs'|'totalOrders'} field  Which count to display
 * @returns {string}
 */
function buildBoard(sorted, field, label) {
  if (!sorted.length) return `> *No data yet — ${label} to get started!*`;

  return sorted
    .slice(0, 10)
    .map((h, i) => {
      const medal = MEDALS[i] ?? `\`#${i + 1}\``;
      const count = h[field] ?? 0;
      return `${medal}  <@${h.userId}>  —  **${count}** order${count !== 1 ? 's' : ''}`;
    })
    .join('\n');
}

// ─── Command definition ───────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('View the leaderboard')
    .addStringOption(opt =>
      opt
        .setName('view')
        .setDescription('Which leaderboard to display (default: all)')
        .setRequired(false)
        .addChoices(
          { name: '📊 All + Weekly (default)', value: 'all'    },
          { name: '📅 Weekly Only',            value: 'weekly' },
          { name: '🛍️ Buyers (Top Orders)',   value: 'buyers' },
        )
    ),

  /**
   * @param {import('discord.js').Client}                  client
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  run: async (client, interaction) => {
    await checkAndResetWeekly();

    const view      = interaction.options.getString('view') ?? 'all';
    const data      = await readJSONOrDefault('handlersRanking.json', {});
    const bannerURL = getBanner(client);
    const thumbURL  = getThumb(client);

    const handlers = Object.values(data);

    const message = await interaction.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [buildRankingContainer(view, handlers, bannerURL, thumbURL)],
      fetchReply: true,
    });

    startAutoRefresh(client, message, view, bannerURL, thumbURL);
  },
};

// ─── Auto-refresh ─────────────────────────────────────────────────────────────

const activeRefreshers = new Map();

function startAutoRefresh(client, message, view, bannerURL, thumbURL) {
  const key = `${message.channelId}-${message.id}`;
  if (activeRefreshers.has(key)) return;

  const interval = setInterval(async () => {
    try {
      await checkAndResetWeekly();
      const data = await readJSONOrDefault('handlersRanking.json', {});
      const handlers = Object.values(data);
      const container = buildRankingContainer(view, handlers, bannerURL, thumbURL);
      await message.edit({
        flags: MessageFlags.IsComponentsV2,
        components: [container],
      });
    } catch (err) {
      if (err.code === 10008 || err.code === 50001) {
        clearInterval(interval);
        activeRefreshers.delete(key);
      }
    }
  }, 30_000);

  activeRefreshers.set(key, interval);
}

function buildRankingContainer(view, handlers, bannerURL, thumbURL) {
  if (view === 'buyers') {
    const tickets   = readJSONOrDefaultSync('tickets.json', {});
    const buyerMap  = {};
    for (const t of Object.values(tickets)) {
      if (!buyerMap[t.userId]) {
        buyerMap[t.userId] = { userId: t.userId, username: t.username || t.userId, totalOrders: 0 };
      }
      buyerMap[t.userId].totalOrders += 1;
    }
    const buyers = Object.values(buyerMap).sort((a, b) => b.totalOrders - a.totalOrders);
    const buyerBoard = buyers.length
      ? buyers.slice(0, 10).map((b, i) => {
          const medal = MEDALS[i] ?? `\`#${i + 1}\``;
          return `${medal}  <@${b.userId}>  —  **${b.totalOrders}** order${b.totalOrders !== 1 ? 's' : ''}`;
        }).join('\n')
      : '> *No buyers yet — be the first to order!*';

    return new ContainerBuilder()
      .setAccentColor(0x57F287)
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(bannerURL),
        ),
      )
      .addSeparatorComponents(sep())
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('🛍️ **Top Buyers**'),
            new TextDisplayBuilder().setContent('Most active customers ranked by total orders'),
          )
          .setThumbnailAccessory(
            new ThumbnailBuilder({ media: { url: thumbURL } }),
          ),
      )
      .addSeparatorComponents(sep())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(buyerBoard),
      );
  }

  if (view === 'weekly') {
    const sorted      = [...handlers].sort((a, b) => (b.weeklyJobs ?? 0) - (a.weeklyJobs ?? 0));
    const weeklyBoard = buildBoard(sorted, 'weeklyJobs', 'close some orders');

    return new ContainerBuilder()
      .setAccentColor(0xFEE75C)
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(bannerURL),
        ),
      )
      .addSeparatorComponents(sep())
      .addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('📅 **Weekly Staff Ranking**'),
            new TextDisplayBuilder().setContent('*Resets every Monday 00:00 WIB (GMT+7)*'),
          )
          .setThumbnailAccessory(
            new ThumbnailBuilder({ media: { url: thumbURL } }),
          ),
      )
      .addSeparatorComponents(sep())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(weeklyBoard),
      );
  }

  const sortedTotal  = [...handlers].sort((a, b) => (b.totalJobs  ?? 0) - (a.totalJobs  ?? 0));
  const sortedWeekly = [...handlers].sort((a, b) => (b.weeklyJobs ?? 0) - (a.weeklyJobs ?? 0));
  const allTimeBoard = buildBoard(sortedTotal,  'totalJobs', 'close some orders');
  const weeklyBoard  = buildBoard(sortedWeekly, 'weeklyJobs', 'close some orders');

  return new ContainerBuilder()
    .setAccentColor(0x5865F2)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(bannerURL),
      ),
    )
    .addSeparatorComponents(sep())
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('🏆 **Staff Leaderboard**'),
          new TextDisplayBuilder().setContent(
            `${handlers.length} staff member${handlers.length !== 1 ? 's' : ''} registered`,
          ),
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder({ media: { url: thumbURL } }),
        ),
    )
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('🏅 **All-Time Ranking**'),
      new TextDisplayBuilder().setContent(allTimeBoard),
    )
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('📅 **Weekly Ranking** *(resets Monday 00:00 WIB)*'),
      new TextDisplayBuilder().setContent(weeklyBoard),
    );
}

function readJSONOrDefaultSync(filename, defaultValue) {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, '..', 'data', filename);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch { /* ignore */ }
  return defaultValue;
}
