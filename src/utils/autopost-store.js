const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', '..', 'config', 'autopost-store.json');

let cache = null;

function loadStore() {
    if (cache) return cache;
    try {
        if (fs.existsSync(STORE_PATH)) {
            cache = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
        } else {
            cache = { users: {}, privateRooms: {} };
        }
    } catch {
        cache = { users: {}, privateRooms: {} };
    }
    return cache;
}

function saveStore() {
    try {
        fs.writeFileSync(STORE_PATH, JSON.stringify(cache, null, 2));
    } catch (e) {
        console.error('[STORE] Failed to save:', e.message);
    }
}

function getUserConfig(userId) {
    const store = loadStore();
    if (!store.users[userId]) {
        store.users[userId] = { channels: [], autoLoginEnabled: false, autoLoginChannel: '1243177096948486186' };
        saveStore();
    }
    return store.users[userId];
}

function setUserConfig(userId, config) {
    const store = loadStore();
    store.users[userId] = config;
    saveStore();
}

function addChannel(userId, channelData) {
    const config = getUserConfig(userId);
    if (config.channels.find(c => c.id === channelData.id)) {
        return false;
    }
    config.channels.push(channelData);
    setUserConfig(userId, config);
    return true;
}

function removeChannel(userId, channelId) {
    const config = getUserConfig(userId);
    const before = config.channels.length;
    config.channels = config.channels.filter(c => c.id !== channelId);
    if (config.channels.length < before) {
        setUserConfig(userId, config);
        return true;
    }
    return false;
}

function createPrivateRoom(userId, roomId, channelId) {
    const store = loadStore();
    store.privateRooms[roomId] = { userId, channelId, createdAt: Date.now(), panelMessageId: null };
    saveStore();
}

function setPanelMessageId(roomId, messageId) {
    const store = loadStore();
    if (store.privateRooms[roomId]) {
        store.privateRooms[roomId].panelMessageId = messageId;
        saveStore();
    }
}

function getPrivateRoom(roomId) {
    const store = loadStore();
    return store.privateRooms[roomId] || null;
}

function deletePrivateRoom(roomId) {
    const store = loadStore();
    if (store.privateRooms[roomId]) {
        delete store.privateRooms[roomId];
        saveStore();
        return true;
    }
    return false;
}

function getUserRoom(userId) {
    const store = loadStore();
    for (const [roomId, room] of Object.entries(store.privateRooms)) {
        if (room.userId === userId) return { roomId, ...room };
    }
    return null;
}

module.exports = {
    getUserConfig,
    setUserConfig,
    addChannel,
    removeChannel,
    createPrivateRoom,
    getPrivateRoom,
    deletePrivateRoom,
    getUserRoom,
    setPanelMessageId
};
