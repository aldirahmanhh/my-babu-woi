/**
 * weeklyReset.js
 *
 * Handles automatic weekly reset of handler ranking (weeklyJobs).
 * Reset fires on Monday 00:00 WIB (UTC+7).
 *
 * Usage:
 *   const { startWeeklyResetTimer } = require('./weeklyReset');
 *   startWeeklyResetTimer(); // call once at bot startup (ranking.js does this)
 */

const { readJSON, writeJSON } = require('./dataManager');

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7 in milliseconds

// Guard so multiple require() calls never spawn duplicate intervals
let timerStarted = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the next Monday 00:00 WIB as a UTC Date.
 * If today IS Monday, the returned date is 7 days from now (next week).
 *
 * @returns {Date} UTC Date of the next Monday 00:00 WIB
 */
function getNextMondayWIB() {
  const nowUTC  = new Date();
  const nowWIB  = new Date(nowUTC.getTime() + WIB_OFFSET_MS);

  // getUTCDay() in WIB context: 0 = Sun, 1 = Mon … 6 = Sat
  const dow = nowWIB.getUTCDay();

  // If today is Monday (1) → next reset is 7 days away
  // Otherwise → (8 - dow) % 7 gives days until next Monday
  const daysUntilMonday = dow === 1 ? 7 : (8 - dow) % 7;

  const nextMondayWIB = new Date(nowWIB);
  nextMondayWIB.setUTCDate(nextMondayWIB.getUTCDate() + daysUntilMonday);
  nextMondayWIB.setUTCHours(0, 0, 0, 0); // midnight WIB

  // Convert back to UTC
  return new Date(nextMondayWIB.getTime() - WIB_OFFSET_MS);
}

// ─── Core Reset Logic ─────────────────────────────────────────────────────────

/**
 * Reads handlersRanking.json and resets weeklyJobs for any handler
 * whose weekResetAt timestamp has passed.  Writes back only if changed.
 */
async function checkAndResetWeekly() {
  try {
    const data = await readJSON('handlersRanking.json');
    if (!data || Object.keys(data).length === 0) return;

    const now     = new Date();
    let   updated = false;

    for (const [userId, handler] of Object.entries(data)) {
      const resetAt = handler.weekResetAt ? new Date(handler.weekResetAt) : null;

      // Reset if the scheduled time has passed, or if weekResetAt is missing
      if (!resetAt || now >= resetAt) {
        console.log(
          `[RANKING] Resetting weekly count for ${handler.username || userId} ` +
          `(was ${handler.weeklyJobs} jobs)`
        );
        data[userId].weeklyJobs  = 0;
        data[userId].weekResetAt = getNextMondayWIB().toISOString();
        updated = true;
      }
    }

    if (updated) {
      await writeJSON('handlersRanking.json', data);
      console.log('[RANKING] Weekly reset complete. Next reset:', getNextMondayWIB().toISOString());
    }
  } catch (err) {
    console.error('[RANKING] Weekly reset error:', err.message);
  }
}

// ─── Timer ────────────────────────────────────────────────────────────────────

/**
 * Starts the hourly check-and-reset interval.
 * Safe to call multiple times — only one interval is ever created.
 */
function startWeeklyResetTimer() {
  if (timerStarted) return;
  timerStarted = true;

  // Check immediately on startup (in case the bot was offline over a reset boundary)
  checkAndResetWeekly();

  // Then check every hour
  setInterval(checkAndResetWeekly, 60 * 60 * 1000);

  console.log(
    '[RANKING] Weekly reset timer started. ' +
    `Next Monday WIB reset ≈ ${getNextMondayWIB().toISOString()}`
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  startWeeklyResetTimer,
  checkAndResetWeekly,
  getNextMondayWIB,
};
