# AutoPost Bot - Architecture Documentation

## Directory Structure

```
src/
├── zar.js                          # Entry point (sharding manager)
├── index.js                        # Client setup & handler loader
├── config/config.json              # Bot config (color, prefix, name)
│
├── events/client/                  # Discord event listeners
│   ├── ready.js                    # Bot startup, presence
│   ├── interactionCreate.js        # Routes all interactions to handlers
│   └── messageCreate.js            # Routes prefix/botname/mention commands
│
├── handlers/                       # Interaction handlers (buttons, modals, selects)
│   ├── autopost-interactions.js    # ap_* button/select/channel-select handlers
│   ├── autopost-modals.js          # ap_* modal submit handlers
│   └── ticket-interactions.js      # ticket_* button/modal handlers
│
├── slashCommands/                  # Slash command definitions
│   ├── AutoPost/autopost-panel.js  # /autopanel - deploy public panel
│   ├── AutoLogin/autologin-setup.js# /autologin - setup in private room
│   ├── Ticket/setup.js             # /ticket setup
│   ├── Ticket/ranking.js           # /ranking leaderboard
│   └── Utility/                    # /autopost, /settoken, /ping
│
├── messageCommands/                # Prefix-based commands
│   ├── AutoPost/autopost.js        # "autopost" / "ap" - opens panel
│   ├── AutoLogin/autologin.js      # "autologin" / "al"
│   └── Info/ping.js                # "ping" / "p"
│
├── utils/                          # Core logic & builders
│   ├── dataManager.js              # JSON file read/write utilities
│   ├── autopost-store.js           # User config & room storage
│   ├── autopost-builder.js         # ★ UI PANEL BUILDERS + AutoPost engine
│   └── autologin-worker.js         # WebSocket gateway worker
│
└── data/                           # JSON storage files
    ├── configTickets.json
    ├── tickets.json
    ├── handlersRanking.json
    ├── userTokens.json
    └── tokenLogs.json
```

---

## Where Things Live

### UI / Embed Builders → `src/utils/autopost-builder.js`

All V2 Components panel builders are here:

| Function | Purpose |
|---|---|
| `buildPanel(userId, client)` | Main AutoPost management panel (31 components) |
| `buildAutoLoginPanel(userId, client)` | Auto-Login sub-panel (19 components) |
| `buildWelcomeContainer(client, username)` | Welcome message for new private rooms (8 components) |
| `buildRemoveChannelSelect(userId)` | Select menu for removing channels |

**Rule:** If it builds a `ContainerBuilder`, `SectionBuilder`, or any visual component — it goes here.

### Interaction Handlers → `src/handlers/`

These handle button clicks, modal submits, and select menu changes:

| File | Handles |
|---|---|
| `autopost-interactions.js` | `ap_*` buttons, string selects, channel selects |
| `autopost-modals.js` | `ap_*` modal submissions |
| `ticket-interactions.js` | `ticket_*` buttons and modals |

**Rule:** If it responds to a user clicking a button or submitting a form — it goes here.

### Business Logic → `src/utils/`

| File | Purpose |
|---|---|
| `autopost-store.js` | User config storage, private room CRUD |
| `autopost-builder.js` | AutoPost engine (`startAutoPost`, `stopAutoPost`, `sendViaUserToken`) |
| `autologin-worker.js` | WebSocket gateway auto-login monitoring |
| `dataManager.js` | Generic JSON file I/O |

### Commands → `src/slashCommands/` and `src/messageCommands/`

| Type | Location | Example |
|---|---|---|
| Slash (`/`) | `src/slashCommands/` | `/autopanel`, `/autologin`, `/settoken` |
| Prefix (`?` or bot name) | `src/messageCommands/` | `autopost`, `ping`, `autologin` |

### Events → `src/events/client/`

| File | Purpose |
|---|---|
| `ready.js` | Bot startup, sets presence |
| `interactionCreate.js` | Central router — dispatches to slash commands, `ap_*` handlers, `ticket_*` handlers |
| `messageCreate.js` | Prefix/botname/mention command router |

---

## Data Flow

### Creating a Private Room

```
User clicks "Create Private Room" button
  → interactionCreate.js detects customId "ap_create_room" or "ap_public_create_room"
    → routes to autopost-interactions.js → handleCreateRoom()
      → store.getUserRoom(userId) — check if room exists
      → guild.channels.create() — create private channel
      → store.createPrivateRoom(userId, roomId, channelId) — save record
      → buildWelcomeContainer() — build welcome UI
      → buildPanel() — build management panel UI
      → channel.send([welcomeContainer, panelContainer]) — send both to room
      → interaction.editReply("Room created!") — confirm to user
```

### Opening the Panel Inside a Room

```
User types "autopost" in their private room
  → messageCreate.js detects prefix/botname trigger
    → routes to messageCommands/AutoPost/autopost.js
      → store.getUserRoom(userId) — check if in private room
      → buildPanel() — build main panel
      → if in private room: also buildWelcomeContainer()
      → message.reply([welcomeContainer, panelContainer]) or just [panelContainer]
```

### Toggling AutoPost

```
User clicks "Start" button on panel
  → interactionCreate.js → autopost-interactions.js → handleTogglePost()
    → store.getUserConfig(userId) — get token & channels
    → isAutoPostActive(userId) — check current state
    → startAutoPost(userId) or stopAutoPost(userId)
    → reply with success/error container
```

### AutoPost Engine (posting loop)

```
startAutoPost(userId)
  → gets config from store (token, channels[])
  → for each channel: starts async loop
    → sendViaUserToken(token, channelId, message) — POST to Discord API
    → wait interval seconds
    → repeat until stopAutoPost(userId) is called
```

---

## Component System

This project uses **Discord Components V2** exclusively. No `EmbedBuilder`.

### Building Blocks

| Component | Purpose |
|---|---|
| `ContainerBuilder` | Top-level wrapper with accent color |
| `SectionBuilder` | Groups text with an accessory (button/thumbnail) |
| `TextDisplayBuilder` | Markdown text |
| `ThumbnailBuilder` | Small image (bot avatar) |
| `MediaGalleryBuilder` | Image banner |
| `SeparatorBuilder` | Visual divider |
| `ButtonBuilder` | Interactive buttons |
| `StringSelectMenuBuilder` | Dropdown menus |
| `ActionRowBuilder` | Container for buttons/selects |

### Limits

- **40 components** max per message
- Welcome container = 8 components
- Main panel = 31 components
- Combined = 39 components (under limit)

### Color Semantics

| Color | Hex | Usage |
|---|---|---|
| Green | `0x57f287` | Success, active state |
| Red | `0xed4245` | Error, danger, stopped |
| Yellow | `0xfee75c` | Warning |
| Blurple | `0x5865f2` | Info, default |

---

## Storage

### `src/utils/autopost-store.js`

File: `config/autopost-store.json`

```json
{
  "users": {
    "<userId>": {
      "channels": [
        { "id": "<channelId>", "message": "...", "interval": 300 }
      ],
      "autoLoginEnabled": false,
      "autoLoginChannel": "<channelId>",
      "autoLoginToken": "<token>"
    }
  },
  "privateRooms": {
    "<roomId>": {
      "userId": "<userId>",
      "channelId": "<channelId>",
      "createdAt": "<timestamp>"
    }
  }
}
```

### `src/utils/dataManager.js`

File: `src/data/*.json` — used for tickets, ranking, tokens.

---

## Key Files Quick Reference

| Need to change... | Edit this file |
|---|---|
| Welcome message in private room | `src/utils/autopost-builder.js` → `buildWelcomeContainer()` |
| Main panel layout/buttons | `src/utils/autopost-builder.js` → `buildPanel()` |
| Button click behavior | `src/handlers/autopost-interactions.js` |
| Modal form behavior | `src/handlers/autopost-modals.js` |
| Slash command behavior | `src/slashCommands/` |
| Prefix command behavior | `src/messageCommands/` |
| AutoPost posting logic | `src/utils/autopost-builder.js` → `startAutoPost()`, `sendViaUserToken()` |
| Storage structure | `src/utils/autopost-store.js` |
| Bot presence on startup | `src/events/client/ready.js` |
| Interaction routing | `src/events/client/interactionCreate.js` |
