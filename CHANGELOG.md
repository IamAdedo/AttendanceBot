# Changelog

All notable changes to the **AttendanceBot** project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.8.0] - 2026-09-25

### Added
- **📜 CLI Terminal 'Command History' Drop-up Menu:**
  - Added a dedicated interactive arrow icon button (`#cliHistoryDropupBtn`, `fa-chevron-up`) directly on the CLI Terminal's command input field (`#cliTerminalInput`).
  - Clicking the arrow opens an accessible, floating drop-up panel listing previously executed commands in reverse chronological order.
  - Each item supports 1-click **Select** (to populate and edit the command line) and 1-click **Re-run** (with instant execution feedback).
  - Built-in persistent history backed by `localStorage` (`attendancebot_cli_history`), capped at 50 commands with automatic duplicate pruning.
  - Supports individual command deletion (`x`), bulk "Clear History", `Escape` dismissal, and click-outside dismissal.
  - Fully integrated with keyboard shortcuts (`Up` / `Down` arrows continue to navigate history seamlessly).
  - Modern high-contrast styling with dark theme and light terminal appearance compatibility.

### Changed
- **📄 Streamlined README & Changelog Linking:**
  - Extracted full historical version entries from `README.md` and added a direct link to `CHANGELOG.md` for clean, focused project documentation.

---

## [3.7.0] - 2026-09-24

### Added
- **❓ Interactive CLI Terminal Help Popover:**
  - Added a dedicated Help icon (`fa-circle-question`) inside the web-based CLI Terminal console header (`#cliTerminalTitleBar`).
  - Opens an interactive Quick Reference popover listing all available terminal commands, categorized into Daemon, Servers, Schedules, Actions, Logs, Credentials, Config, Diagnostics, and Utilities.
  - Included a real-time live search filter to instantly find commands by keyword, arguments, or description.
  - Built interactive one-click execution (`Click to run`) for standalone commands and one-click insertion (`Click to insert`) for commands with templates and parameters into `#cliTerminalInput`.
  - Added click-outside and `Escape` key listeners for effortless dismissal.

### Fixed
- **🌐 Dev Server Startup & Container Healthcheck Compatibility:**
  - Configured Express server in `server.js` with dual-adapter listeners: keeping **port 3271** as the primary base port while providing the required container runtime adapter on **port 3000** for the dev environment and iframe preview proxy.
  - Resolved dev server startup issues, ensuring both local dashboard development on `http://localhost:3271` and dev preview on `http://localhost:3000` run simultaneously with zero port collisions.

---

## [3.6.0] - 2026-09-24

### Changed & Fixed
- **🚫 Complete Elimination of Port 3000 Conflicts:**
  - Configured AttendanceBot to **never look at, probe, or bind port 3000** under any circumstances, preventing development environment and local service collisions.
  - Hardened Express web server configuration in `server.js` to strictly enforce **port 3271** as the primary base port (`PRIMARY_BASE_PORT = 3271`).
  - Removed all legacy preview adapters and secondary listeners on port 3000 in `server.js`.
  - Updated CLI server detection (`probeServer` in `bin/cli.js`) to exclusively probe port 3271 without falling back or querying port 3000.
  - Documented strict primary base port policy in `.env.example`, `server.js`, `bin/cli.js`, and `README.md`.

---

## [3.5.0] - 2026-09-24

### Added & Changed
- **🌐 Single Source of Truth Global Versioning:**
  - Consolidated version resolution in `src/version.js` dynamically resolving from `package.json`.
  - Synchronized header badge (`#appHeaderVersionBadge`) and footer badge (`#appFooterVersionBadge`) with `.global-app-version`.
  - Added dedicated `/api/version` endpoint and included dynamic version metadata in `/api/status`, export payloads, and schema validator.
  - Updated interactive CLI menu banners and help commands to dynamically reflect current package version.

---

## [3.4.0] - 2026-09-24

### Added & Improved
- **⚡ Enhanced Schema Validation & CLI Management:**
  - Expanded JSON schema validator with deep channel snowflake checks and cron format linting.
  - Added live daemon process synchronization between CLI engine and Web Dashboard via hot-reloading watchers.

---

## [3.3.0] - 2026-09-24

### Added
- **📁 Configuration Backup & Hot Reloading:**
  - Bidirectional hot-sync watching `config.json` for external CLI or editor changes.
  - Safe configuration export & import with structural sanity verification.

---

## [3.2.0] - 2026-09-23

### Added & Improved
- **🖥️ Light-Mode CLI Terminal Readability Overhaul:**
  - Redesigned light-theme styles for the web-based interactive CLI console.
  - Command prompts (`attendancebot:~$`), user input, execution output, error states, and quick-command chips feature accessible contrast in light mode.
  - Added interactive Terminal Appearance toggle (`fa-circle-half-stroke`) to switch the CLI between clean light theme and classic hacker dark terminal skin independently.
- **🛡️ Duplicate Server Profile Prevention & Smart Schedule Redirect:**
  - Added duplicate server validation by Server Name and Discord Channel ID across REST API (`POST /api/servers`), frontend modal (`handleSaveServer`), and CLI engine (`server add`).
  - When a duplicate server is entered, the app gracefully dismisses the server creation dialog, displays a toast notification, and automatically redirects the user to the "Add Attendance Schedule" dialog pre-targeted to that server with an informative banner.
- **💬 Custom Dialogue Boxes for All Deletions:**
  - Completely replaced native browser `confirm()` popups with styled, accessible modal dialogs (`#confirmDialogModal`).
  - Applied to single server profile deletion, schedule routine deletion, bulk server deletion, and configuration snapshot restores.
- **⚠️ Rate-Limit Overlap Warning Badges:**
  - Prominent visual warning icons on the server profile card when multiple routines trigger within a 5-minute window in the same channel.

---

## [3.1.0] - 2026-09-22

### Added
- **⚠️ Rate-Limit Conflict Warning Icons:**
  - Added visual warning icons across server profile cards for schedules within 5 minutes of each other on the same channel.
  - Enhanced warning banner detailing schedule labels, execution times, and spacing recommendations.

---

## [3.0.0] - 2026-09-20

### Added
- **🔀 Drag-and-Drop Schedule Prioritization:**
  - Added HTML5 drag-and-drop table rows allowing users to reorder attendance schedules visually.
  - Added execution sequence tags (`#1`, `#2`, ...) and up/down priority adjusters.
  - Implemented backend endpoint `POST /api/servers/:serverId/schedules/reorder`.
- **⏱️ Real-Time Elapsed Check-in Clock:**
  - Added elapsed time clock badge on each server profile row and server header.
- **▶️ Immediate 'Test Run' Play Button:**
  - Added one-click test run button on every schedule row.

---

## [2.0.0] - 2026-09-15

### Added
- **🌐 Web Management Dashboard & REST API:**
  - Express full-stack architecture with Discord dark and light themes.
  - Live daemon process management (Start, Stop, Restart) from browser.
- **👍 Reaction-Based Attendance:**
  - Support for emoji reactions (`REACTION` mode) alongside standard text messages (`MESSAGE` mode).
- **📊 30-Day Attendance Analytics:**
  - Historical tracking with interactive Recharts visualizations.
- **📜 Live Activity Logs & CSV Export:**
  - Real-time in-browser log streaming with level filters and CSV export.

---

## [1.0.0] - 2026-09-01

### Added
- **⚡ Initial Release:**
  - Interactive command-line setup wizard (`bin/cli.js`).
  - PM2 background daemon management.
  - Automated cron scheduling for Discord channel attendance messages.
  - Multi-server profile storage in `config.json`.
