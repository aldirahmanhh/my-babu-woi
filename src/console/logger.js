const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'bot.log');

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function timestamp() {
    return new Date().toISOString();
}

console.log = function (...args) {
    const msg = `[${timestamp()}] [LOG] ${args.join(' ')}`;
    logStream.write(msg + '\n');
    originalLog.apply(console, args);
};

console.error = function (...args) {
    const msg = `[${timestamp()}] [ERROR] ${args.join(' ')}`;
    logStream.write(msg + '\n');
    originalError.apply(console, args);
};

console.warn = function (...args) {
    const msg = `[${timestamp()}] [WARN] ${args.join(' ')}`;
    logStream.write(msg + '\n');
    originalWarn.apply(console, args);
};

process.on('uncaughtException', (err) => {
    const msg = `[${timestamp()}] [UNCAUGHT] ${err.stack || err.message}`;
    logStream.write(msg + '\n');
});

process.on('unhandledRejection', (reason) => {
    const msg = `[${timestamp()}] [UNHANDLED] ${reason}`;
    logStream.write(msg + '\n');
});

console.log(`[LOGGER] Log file: ${LOG_FILE}`);
