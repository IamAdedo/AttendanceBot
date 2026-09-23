# ⚡ AttendanceBot

```text
██╗     ██████╗ ███████╗
██║     ╚════██╗██╔════╝
██║      █████╔╝█████╗
██║     ██╔═══╝ ██╔══╝
███████╗███████╗███████╗
╚══════╝╚══════╝╚══════╝
```

> **AttendanceBot v3.2.0 by IamAdedo, dlazyHNTR**  
> *Automated multi-server Discord daily attendance background daemon with an interactive Web Management Dashboard, drag-and-drop schedule prioritization, real-time check-in telemetry, rate-limit conflict warnings, and a complete CLI suite.*

---

## 📌 Badges & Metadata

- **Current Version:** `v3.2.0`
- **Dashboard Port:** `http://localhost:3000`
- **Node.js Requirement:** `18.0.0` or higher
- **License:** MIT
- **Supported Platforms:** Windows, macOS, Linux, and Android (Termux — No Root Needed)

---

## 🤔 What Does This Do?

**AttendanceBot** automates daily attendance and scheduled check-ins across multiple Discord servers and channels. It supports sending custom text messages (e.g., `"Present"`, multi-line updates) or reacting with emojis to messages at defined schedules.

You can manage the bot via:
1. **Interactive Web Dashboard** on `http://localhost:3000` with real-time statistics, drag-and-drop reordering, one-click manual test runs, and rate-limit conflict detection.
2. **Terminal CLI & Remote Controller** (`npm run cli` / `node bin/cli.js`) for rapid headless administration.
3. **Background Daemon** running 24/7 with auto-restart on system boot.

---

## ✨ Features

- 🌐 **Modern Web Management Dashboard** — Responsive Discord dark/light interface on port 3000 for managing servers, schedules, credentials, and live daemon controls.
- ⚠️ **Rate-Limit Conflict Detection & Visual Warning Icons** *(New in v3.1)* — Prominent visual warning icons on the server profile card (avatar badge, header tag, channel row, and schedule rows) when multiple routines trigger within a 5-minute window in the same channel, preventing potential Discord rate-limiting.
- 🔀 **Drag-and-Drop Schedule Prioritization** — Reorder attendance execution sequences with intuitive drag-and-drop rows, priority indicators (`#1`, `#2`...), and up/down controls.
- ⏱️ **Time Elapsed Since Last Check-in** — Live check-in clock badge (`fa-regular fa-clock`) on each server profile row and server header calculating exact elapsed time since the last successful attendance check-in.
- ▶️ **One-Click 'Test Run' Play Button** — Execute immediate manual test runs on any schedule with animated spinner states, instant toast notifications, and live telemetry updates.
- 💻 **Interactive CLI Suite** — Headless terminal CLI with commands for status, logs, server management, and schedule ordering (`schedule move`, `schedule reorder`).
- 🏢 **Multi-Server & Multi-Schedule Profiles** — Manage unlimited Discord servers, each with distinct channel targets, frequencies, and payloads.
- 📅 **Flexible Scheduling Modes** — Everyday, weekdays, weekends, specific repeating weekdays (e.g., every Monday), or a **one-time calendar date** that auto-disables after execution.
- 💬 **Message OR Reaction Modes** — Dispatch multi-line text messages OR react with custom emojis to channel messages.
- 🛡️ **Anti-Detection Jitter** — Configurable randomized delay window (1-10+ minutes) to prevent rigid, bot-like repetitive timestamps.
- 🔔 **Discord Webhook Alerts** — Instant notification embeds dispatched to your personal Discord channel with execution summaries and delivery status.
- 📊 **30-Day Attendance Analytics** — Interactive visualizations, check-in heatmaps, 30-day success rates, and streak counters.
- 📜 **Live Activity Logs & CSV Export** — Real-time event streaming with severity filters, search queries, and one-click CSV file export.
- 💾 **Auto-Save & Configuration Backups** — Automatic profile snapshots and hot JSON configuration export/import with version metadata.
- 📱 **Android Support (Termux No-Root)** — Native mobile background service with wake lock and Termux:Boot resurrection.

---

## 🚀 Quick Start Guide

### Step 1: Clone and Install Dependencies

```bash
# Clone the repository
git clone https://github.com/IamAdedo/attendanceBot.git

# Enter the project directory
cd attendanceBot

# Install npm dependencies
npm install
```

### Step 2: Launch the Web Dashboard

```bash
npm start
# or: npm run dev
```

Open your browser to:
👉 **`http://localhost:3000`**

From the dashboard you can:
- Enter your **Discord User Token** securely under **Credentials & Webhook**.
- Add a **Discord Webhook URL** for real-time mobile push notifications.
- Create Server Profiles with target **Channel IDs**.
- Configure, reorder, and test attendance schedules.
- Start or stop the background daemon with one click.

---

## 💻 CLI Operations & Headless Management

AttendanceBot includes a CLI engine that can run standalone or communicate with the running server:

```bash
# Launch interactive terminal CLI
npm run cli

# Or execute individual commands directly:
node bin/cli.js status
node bin/cli.js list
node bin/cli.js logs 20
```

### CLI Command Reference

| Command | Description |
| :--- | :--- |
| `status` | Display daemon status, uptime, and configured profile count |
| `start` / `stop` / `restart` | Control background attendance daemon process |
| `list` (or `servers`) | List all configured server profiles and their schedules |
| `server add <name> <chanId> [cron] [msg]` | Create a new server profile |
| `server pause <id\|name>` | Temporarily pause attendance check-ins for a server |
| `server resume <id\|name>` | Resume attendance check-ins for a server |
| `server delete <id\|name>` | Remove a server profile |
| `server enable-all` / `disable-all` | Bulk toggle all server profiles |
| `schedule list <srvId>` | List all schedules for a specific server |
| `schedule add <srvId> <cron> [msg]` | Add a schedule to a server |
| `schedule delete <srvId> <schedId>` | Remove a schedule from a server |
| `schedule reorder <srvId> <id1,id2,...>` | *(New in v3)* Reorder execution priority sequence by schedule IDs |
| `schedule move <srvId> <fromPos> <toPos>` | *(New in v3)* Move a schedule from one priority position to another |
| `trigger <serverId> [scheduleId]` | Manually trigger an immediate test run |
| `logs [count]` | Display recent activity logs (default: 15) |
| `token [new_token]` | View or update Discord account user authorization token |
| `webhook [url]` | View or update global Discord notification webhook |
| `webhook test [url]` | Dispatch a test embed notification to verify webhook |
| `backup` | Export current configuration JSON snapshot |
| `uptime` | View daemon uptime and execution reliability metrics |

---

## 🔀 Drag-and-Drop Schedule Prioritization & Test Runs

### Drag-and-Drop Execution Sequencing
1. Navigate to **Server Profiles** in the Web Dashboard.
2. In the schedules table for any server, grab the **Priority handle** (`:::`) on any row.
3. Drag the schedule row up or down to set its sequence order.
4. Release the row — the priority badges (`#1`, `#2`...) update immediately and the order is persisted to the backend via `/api/servers/:serverId/schedules/reorder`.
5. You can also use the inline up/down chevron buttons or the CLI `schedule move` command.

### Time Elapsed Since Last Check-in
- Each server card displays an elapsed time counter badge with a clock icon (`fa-regular fa-clock`) right beside the Channel ID.
- Shows the duration since the latest successful check-in (e.g., `< 1m ago`, `2h 15m ago`).
- Synchronized with the server header uptime badge in real time.

### Immediate 'Test Run' Play Button
- Click the emerald **Test Run** play button (`▶`) on any schedule row.
- The button activates an immediate spinner state (`Running...`), executes the attendance routine, logs the outcome, registers the entry in attendance history, and refreshes the elapsed check-in clock without reloading the page.

---

## 🔄 24/7 Background Service Installation

To run AttendanceBot as a background service that persists across terminal closures and system reboots:

```bash
# Install and start PM2 background service
npm run service:install

# Check service status
npm run service:status

# Watch real-time logs
npm run service:logs

# Uninstall/Stop service
npm run service:uninstall
```

### Auto-Start on System Boot

- **Windows:** Run in PowerShell as Administrator:
  ```powershell
  npm install -g pm2-windows-startup
  pm2-startup install
  ```
- **macOS:**
  ```bash
  npx pm2 startup launchd
  ```
- **Linux:**
  ```bash
  npx pm2 startup systemd
  ```

### Android (Termux — No Root Required)

1. Install **Termux** from F-Droid.
2. Install Node.js:
   ```bash
   pkg update && pkg upgrade -y
   pkg install nodejs-lts termux-api -y
   ```
3. Clone and install AttendanceBot:
   ```bash
   git clone https://github.com/IamAdedo/attendanceBot.git
   cd attendanceBot
   npm install
   npm start
   ```
4. Background persistence:
   - Install **Termux:API** app from F-Droid for Android wake locks.
   - Install **Termux:Boot** app from F-Droid to automatically launch AttendanceBot when your phone boots.

---

## 🔑 Obtaining Your Discord Credentials

### Discord User Token
> ⚠️ **IMPORTANT**: Your token grants access to your Discord account. Never share it with anyone or commit it to a public repository.

1. Open Discord in your desktop browser or app.
2. Press `F12` (or `Ctrl + Shift + I` on Windows/Linux, `Cmd + Option + I` on Mac).
3. Switch to the **Console** tab.
4. Paste the following script and press **Enter**:
   ```javascript
   (webpackChunkdiscord_app.push([[''],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]),m).find(m=>m?.exports?.default?.getToken!==void 0).exports.default.getToken()
   ```
5. Copy the returned token string without quotes.
6. Paste the token into the AttendanceBot dashboard (**Credentials & Webhook** tab).

### Discord Channel ID
1. In Discord, navigate to **User Settings** (gear icon) → **Advanced** (under App Settings).
2. Toggle on **Developer Mode**.
3. Right-click the channel where attendance should post and click **Copy Channel ID**.

---

## 📝 Changelog

### Version 3.2.0 (Current)
- **🖥️ Light-Mode CLI Terminal Readability Overhaul:**
  - Redesigned light-theme styles for the web-based interactive CLI console.
  - Command prompts (`attendancebot:~$`), user input, execution output, error states, and quick-command chips now feature crisp, accessible contrast in light mode.
  - Added interactive Terminal Appearance toggle (`fa-circle-half-stroke`) allowing users to switch the CLI between clean light theme and classic hacker dark terminal skin independently.
- **🛡️ Duplicate Server Profile Prevention & Smart Schedule Redirect:**
  - Added duplicate server validation by Server Name and Discord Channel ID across REST API (`POST /api/servers`), frontend modal (`handleSaveServer`), and CLI engine (`server add`).
  - When a duplicate server is entered, the app gracefully dismisses the server creation dialog, displays a toast notification, and automatically redirects the user to the "Add Attendance Schedule" dialog pre-targeted to that server with an informative banner.
- **💬 Custom Dialogue Boxes for All Deletions:**
  - Completely replaced native browser `confirm()` popups with styled, accessible modal dialogs (`#confirmDialogModal`).
  - Applied to single server profile deletion, schedule routine deletion, bulk server deletion, and configuration snapshot restores.
  - Displays rich context cards (Server Name, Channel ID, affected routines, backup timestamps), customized action icons, and keyboard support (`Escape` to safely dismiss, auto-focus on Cancel).
- **⚠️ Rate-Limit Overlap Warning Badges:**
  - Prominent visual warning icons on the server profile card (avatar badge, header tag, channel row, and schedule rows) when multiple routines trigger within a 5-minute window in the same channel, preventing potential Discord rate-limiting.

---

### Version 3.1.0
- **⚠️ Rate-Limit Conflict Warning Icons:**
  - Added visual warning icons (`fa-solid fa-triangle-exclamation`) across server profile cards:
    - Floating warning badge on server `#` icon box.
    - Prominent `Rate-Limit Warning (≤5m overlap)` tag next to the server profile title.
    - Conflict indicator tag in the server metadata bar next to the channel ID and last check-in clock.
    - Per-schedule `≤5m Rate-Limit Risk` badge in each schedule table row.
  - Mitigates potential Discord rate-limiting and temporary blocks when multiple schedules are scheduled to execute within the same 5-minute window for a channel.
  - Enhanced warning banner detailing the exact schedule labels, execution times, minute differences, and practical anti-rate-limit spacing tips.
- **🔄 Semantic Version Bump:**
  - Followed version bump policy: bumped minor version from `3.0` to `3.1` across `package.json`, REST API exports, client headers, footers, and docs.

---

### Version 3.0.0
- **🔀 Drag-and-Drop Schedule Prioritization:**
  - Added HTML5 drag-and-drop table rows allowing users to reorder attendance schedules visually.
  - Added execution sequence tags (`#1`, `#2`, ...) and up/down priority adjusters.
  - Implemented backend endpoint `POST /api/servers/:serverId/schedules/reorder` with automatic config persistence and live schedule reinitialization.
- **⏱️ Real-Time Elapsed Check-in Clock:**
  - Added dedicated elapsed time clock badge (`fa-regular fa-clock`) on each server profile row and server header.
  - Formats duration since the last successful check-in dynamically (e.g. `< 1m ago`, `2h 15m ago`).
- **▶️ Immediate 'Test Run' Play Button:**
  - Added emerald one-click play button on every schedule row.
  - Interactive spinner loading state (`Running...`) and instant toast feedback.
  - Automatically records check-ins in the attendance history and updates elapsed check-in timers in real time without refreshing.
- **💻 CLI Enhancements:**
  - Added `schedule reorder <serverId> <id1,id2,...>` to terminal CLI engine.
  - Added `schedule move <serverId> <fromPosition> <toPosition>` to easily change schedule priority by index.
- **🔄 Semantic Version Synchronization:**
  - Full version synchronization across `package.json`, REST API exports, client headers, footers, and documentation.
  - Enforced version bump policy: minor bumps (e.g. `3.0` to `3.1`) for incremental enhancements, major bumps (`3` to `4`) for architectural updates.

---

### Version 2.0.0 & 2.1.0
- **🌐 Web Management Dashboard & REST API:**
  - Built Express full-stack architecture running on port 3000 (`server.js`, `public/index.html`, `public/app.js`).
  - Implemented Discord dark and light themes with responsive navigation.
  - Added live daemon process management (Start, Stop, Restart) directly from the browser.
- **👍 Reaction-Based Attendance:**
  - Added support for emoji reactions (`REACTION` mode) alongside standard text messages (`MESSAGE` mode).
  - Configurable target message ID or automatic fallback to the latest message in the channel.
- **📊 30-Day Attendance Analytics:**
  - Added 30-day historical tracking with interactive Recharts visualizations.
  - Heatmap daily breakdown, peak usage calculation, and streak tracking.
- **📜 Live Activity Logs & CSV Export:**
  - Real-time in-browser log streaming with level filters (INFO, SUCCESS, WARN, ERROR) and search filter.
  - One-click export of activity history as CSV spreadsheet.
- **💾 Automated Backups & Export/Import:**
  - Added JSON configuration export and hot import.
  - Local auto-save and automated configuration backup mechanisms.
- **⚠️ Conflict Detection:**
  - Real-time detection of overlapping schedules running within 5 minutes of each other on the same channel.

---

### Version 1.0.0
- **⚡ Initial CLI & Background Daemon:**
  - Interactive command-line setup wizard (`bin/cli.js`).
  - PM2 background daemon management (`npm run service:install` / `npm run service:uninstall`).
  - Automated cron scheduling for Discord channel messages.
  - Multi-server profile storage in `config.json`.
  - Multi-line attendance messages.
  - Anti-detection random delay (jitter) window.
  - Discord webhook dispatch for attendance success and error notifications.
  - Native Android support via Termux (no root required) with wake lock and boot scripts.

---

## 📌 Versioning Policy

AttendanceBot adheres to semantic versioning guidelines:
- **Patch / Minor Bump (`3.0` → `3.1`):** Applied for small improvements, UI enhancements, optimizations, and bug fixes.
- **Major Bump (`3.0` → `4.0`):** Applied for major feature additions, breaking API changes, or significant architectural updates.

---

## ⚠️ Important Guidelines & Disclaimer

1. **Discord Terms of Service:** Automated user accounts ("self-bots") violate Discord's Terms of Service. Always enable the anti-detection jitter delay, avoid spamming, and consider using dedicated accounts.
2. **Token Security:** Your Discord token provides full access to your account. Never commit `config.json` to GitHub or disclose your token to anyone.
3. **Personal & Educational Use:** This software is provided for personal workflow automation and educational purposes. Use responsibly.

---

## 📞 Support & Community

- **Authors:** IamAdedo, dlazyHNTR
- **License:** MIT License
- **Issues & Contributions:** Contributions and bug reports are welcome via GitHub Issues.

*...with love by The !Lazy Hunter <||>*
