/**
 * dataManager.js
 * Centralised helper for reading and writing JSON data files.
 * All persistent data lives under src/data/.
 *
 * Usage:
 *   const { readJSON, writeJSON, readJSONOrDefault } = require('../utils/dataManager');
 *   const data = await readJSONOrDefault('tickets.json', {});
 *   await writeJSON('tickets.json', data);
 */

const fs   = require('fs').promises;
const path = require('path');

// Absolute path to the data directory (src/data/)
const DATA_DIR = path.join(__dirname, '..', 'data');

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Ensures the data directory exists (creates it recursively if not).
 * Called before every read/write so callers never have to think about it.
 */
async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads a JSON file from the data directory and returns the parsed object.
 *
 * @param {string} filename  Filename only, e.g. 'tickets.json'
 * @returns {Promise<any|null>}  Parsed data, or null if the file does not exist
 * @throws  Re-throws any error that is NOT a missing-file (ENOENT) error
 */
async function readJSON(filename) {
  await ensureDataDir();
  const filePath = path.join(DATA_DIR, filename);

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;            // file simply doesn't exist yet
    if (err instanceof SyntaxError) {
      console.error(`[DATA] Corrupt JSON in ${filename}:`, err.message);
      return null;
    }
    console.error(`[DATA] Error reading ${filename}:`, err.message);
    throw err;
  }
}

/**
 * Writes data to a JSON file in the data directory (pretty-printed, 2-space indent).
 * Creates the file if it does not exist; overwrites it if it does.
 *
 * @param {string} filename  Filename only, e.g. 'tickets.json'
 * @param {any}    data      Any JSON-serialisable value
 * @returns {Promise<void>}
 */
async function writeJSON(filename, data) {
  await ensureDataDir();
  const filePath = path.join(DATA_DIR, filename);

  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[DATA] Error writing ${filename}:`, err.message);
    throw err;
  }
}

/**
 * Like readJSON, but returns `defaultValue` when the file is missing or empty
 * instead of null.  Useful for initialising collections on first use.
 *
 * @param {string} filename
 * @param {any}    defaultValue  Value returned when the file is absent/empty
 * @returns {Promise<any>}
 *
 * @example
 *   const logs = await readJSONOrDefault('tokenLogs.json', { logs: [] });
 */
async function readJSONOrDefault(filename, defaultValue) {
  const data = await readJSON(filename);
  // Return defaultValue for both null (missing) and edge-case empty result
  return data ?? defaultValue;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { readJSON, writeJSON, readJSONOrDefault };
