Here is a complete, production-ready `README.md` for **AttendanceBot**, tailored to your project structure, setup flow, background daemon capabilities, and official author branding.

---

```markdown
# ⚡ AttendanceBot

```text
██╗     ██████╗ ███████╗
██║    ╚════██╗██╔════╝
██║     █████╔╝█████╗  
██║    ██╔═══╝ ██╔══╝  
███████╗███████╗███████╗
╚══════╝╚══════╝╚══════╝

```

> **AttendanceBot by IamAdedo, dlazyHNTR**
> *A robust, multi-server Discord daily attendance automation daemon with anti-detection jitter, step-by-step CLI setup, cross-platform background process persistence, and real-time Discord Webhook notifications.*

---

## 📖 Overview

**AttendanceBot** is a lightweight, cross-platform CLI tool and background service designed to automatically send scheduled attendance messages (e.g., `"Present"`, `"Check-in"`, `"gm"`) across multiple Discord servers simultaneously.

Built with **`discord.js-selfbot-v13`** and managed by **PM2**, AttendanceBot runs silently as an OS background daemon across **Windows**, **macOS**, and **Linux/Ubuntu**.

---

## ✨ Key Features

* 🖥️ **Interactive CLI Manager:** Simple, step-by-step terminal prompt wizard (`npm start`) to manage servers, credentials, and schedules—no coding or manual JSON editing required.
* 🌐 **Multi-Server & Multi-Schedule:** Manage multiple Discord server profiles under one running process, each with its own target channels and multiple daily execution times.
* ⏰ **Human-Like Anti-Detection Jitter:** Configurable randomized delay offsets (e.g., 1–10 minutes) before posting to eliminate exact-second execution patterns and bypass bot detection.
* 🔔 **Discord Webhook Alerts:** Receive real-time push notifications on your phone or main Discord server whenever an attendance message is posted or if an error occurs.
* 🔄 **Cross-Platform OS Daemon:** Integrates with PM2 to run continuously in the background and survive system reboots (`systemd` on Linux, `launchd` on macOS, and `Windows Startup Service`).
* 🛠️ **Pause / Resume / Manage:** Dynamically pause or edit server profiles from the CLI without breaking background process state.

---

## 🛠️ Project Architecture

```text
attendance-bot/
├── bin/
│   ├── cli.js               # Interactive Terminal Dashboard & Setup Wizard
│   ├── install-service.js   # PM2 Background Service Installer
│   └── uninstall-service.js # Service Removal Utility
├── src/
│   ├── bot.js               # Multi-profile Daemon Core Engine
│   └── logger.js            # Formatted Console Logger
├── config.json              # Local Database (Auto-generated)
├── package.json
└── README.md

```

---

## 🚀 Quick Start

### Prerequisites

* **Node.js**: `v18.0.0` or higher
* **npm**: `v9.0.0` or higher
* **Discord User Token** & **Target Channel ID(s)**

---

### Step 1: Installation

Clone the repository and install dependencies:

```bash
git clone [https://github.com/IamAdedo/attendance-bot.git](https://github.com/IamAdedo/attendance-bot.git)
cd attendance-bot
npm install

```

---

### Step 2: Interactive Configuration

Launch the interactive setup wizard:

```bash
npm start

```

Follow the step-by-step terminal prompts:

1. **Enter Discord User Token:** Authenticate your account.
2. **Set Webhook URL (Optional):** Receive success/failure push notifications.
3. **Add Server Profile:** Give your configuration a name (e.g., `Work-DAO`, `Study-Group`).
4. **Target Channel ID:** Input the channel snowflake ID where attendance is submitted.
5. **Schedule Builder:** Choose frequency (*Everyday*, *Weekdays*, *Weekends*) and preferred time (*e.g., 08:30 AM*).
6. **Set Anti-Detection Jitter:** Choose a max delay (e.g., `10` minutes) to randomize execution time daily.

---

### Step 3: Install & Start Background Daemon

To run AttendanceBot in the background and ensure it stays active even when your terminal is closed:

```bash
npm run service:install

```

---

## 🔑 Extracting Your Discord User Token

To authenticate as yourself, extract your token from the browser developer console:

> ⚠️ **Warning:** Never share your user token. Anyone with your token has full access to your Discord account.

1. Open Discord in your web browser or desktop app.
2. Press `F12` (or `Ctrl + Shift + I` / `Cmd + Option + I`) to open **Developer Tools**.
3. Select the **Console** tab.
4. Paste the following snippet and hit **Enter**:
```javascript
window.webpackChunkdiscord_app.push([
  [Math.random()],
  {},
  req => {
    for (const m of Object.values(req.c)) {
      if (m?.exports?.default?.getToken) {
        console.log(m.exports.default.getToken());
      }
    }
  }
]);

```


5. Copy the output string and paste it into the CLI wizard when prompted.

---

## 💻 Service Management Commands

AttendanceBot provides built-in `npm` scripts to manage the background daemon via PM2:

| Action | Command | Description |
| --- | --- | --- |
| **Launch CLI Dashboard** | `npm start` | Manage profiles, view schedules, pause/resume servers |
| **Install Background Daemon** | `npm run service:install` | Starts PM2 daemon and saves reboot process snapshot |
| **Check Daemon Status** | `npm run service:status` | View uptime, memory usage, and execution status |
| **Stream Live Logs** | `npm run service:logs` | Stream real-time logs and attendance triggers |
| **Stop & Uninstall Service** | `npm run service:uninstall` | Stop daemon and remove background task |

---

## ⚙️ Enabling Automatic System Boot

To enable automatic startup when your computer boots up:

### 🪟 Windows (Powershell as Administrator)

```powershell
npm install -g pm2-windows-startup
pm2-startup install

```

### 🍎 macOS

```bash
npx pm2 startup launchd

```

### 🐧 Linux / Ubuntu

```bash
npx pm2 startup systemd

```

---

## 🔔 Discord Webhook Embed Preview

When an attendance message posts, your webhook receives a formatted notification:

```text
==================================================
✅ Attendance Posted Successfully
==================================================
Server Profile : Alpha Squad
Channel        : #daily-checkin
Schedule       : 08:30 AM (Weekdays)
Message Sent   : "Present Sir!"
Timestamp      : Wednesday, August 5, 2026 8:43 AM

AttendanceBot by IamAdedo, dlazyHNTR
==================================================

```

---

## ⚠️ Disclaimer & Safety Guidelines

* **Discord ToS:** Automating user accounts (*self-bots*) violates [Discord's Terms of Service](https://discord.com/terms). Use this tool responsibly and at your own risk.
* **Avoid Exact Timings:** Always keep **Anti-Detection Jitter** enabled (minimum 5–15 minutes) to mimic natural human typing behavior and avoid automated flagging.

---

## 👤 Author & License

Created by **IamAdedo, dlazyHNTR**

Distributed under the **MIT License**. See `LICENSE` for more information.

```

```
