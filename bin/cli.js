#!/usr/bin/env node

/**
 * bin/cli.js
 *
 * AttendanceBot Interactive and Command-Line Management Interface.
 * Version: 3.7.0
 *
 * Supports:
 * 1. Dual-interface management: Terminal CLI and Web Dashboard.
 * 2. Spinning up the Web Dashboard in a dedicated separate terminal window (Windows, macOS, Linux GUI, tmux)
 *    or detached background process so the user can continue interacting with the CLI without interruption.
 * 3. Offline standalone mode with direct local config & DaemonManager when web server is not running.
 * 4. Online synchronization over HTTP REST API to localhost:3271 when web server is spinning.
 * 5. Direct CLI argument execution: `attendanceBot status`, `attendanceBot list`, `attendanceBot start`, etc.
 * 6. Interactive menu wizard for servers, duplicate detection with redirect, schedules, credentials, and daemon.
 * 7. Configuration export & import with strict JSON schema validation.
 * 8. PM2 background service management (install, uninstall, status, logs).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const http = require('http');
const https = require('https');
const { spawn, exec, execSync } = require('child_process');
const cron = require('node-cron');

const CliEngine = require('../src/cliEngine');
const { validateConfigSchema } = require('../src/schemaValidator');
const { VERSION, DISPLAY_VERSION } = require('../src/version');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const PID_PATH = path.join(__dirname, '..', '.server.pid');
const LOGS_DIR = path.join(__dirname, '..', 'logs');
const SERVER_LOG_PATH = path.join(LOGS_DIR, 'server.log');

// Force primary base port to 3271 and prevent conflicts by never looking at port 3000
const PRIMARY_BASE_PORT = 3271;
const SERVER_PORT = (process.env.PORT && process.env.PORT !== '3000')
    ? parseInt(process.env.PORT, 10)
    : PRIMARY_BASE_PORT;
let activeServerUrl = `http://127.0.0.1:${SERVER_PORT}`;
const SERVER_URL = activeServerUrl;

let serverStatusData = null;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const ask = (query) => new Promise((resolve) => rl.question(query, (ans) => resolve(ans.trim())));

/**
 * Collects a multi-line message from terminal.
 */
async function askMultiline(defaultValue = 'Present') {
    console.log('  ✏️  Enter your message. Multiple lines allowed.');
    console.log('     Press Enter on an EMPTY line to finish.');
    console.log(`     (Leave the first line blank to use default: "${defaultValue.replace(/\n/g, ' / ')}")`);

    const lines = [];
    while (true) {
        const line = await new Promise((resolve) => rl.question('  > ', (ans) => resolve(ans)));
        if (line.trim() === '') {
            break;
        }
        lines.push(line);
    }

    return lines.length > 0 ? lines.join('\n') : defaultValue;
}

/**
 * Fast probe to see if AttendanceBot Web Server is online on primary base port 3271.
 * Strictly avoids looking at port 3000 to prevent port conflicts.
 */
function probeServer() {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${SERVER_PORT}/api/status`, { timeout: 1200 }, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                let body = '';
                res.on('data', (c) => { body += c; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        serverStatusData = parsed;
                        activeServerUrl = `http://127.0.0.1:${SERVER_PORT}`;
                        resolve(true);
                    } catch (e) {
                        resolve(false);
                    }
                });
            } else {
                resolve(false);
            }
        });
        req.on('error', () => {
            resolve(false);
        });
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
}

/**
 * Execute command via live spinning server
 */
function execViaServer(commandLine) {
    return new Promise((resolve) => {
        const payload = JSON.stringify({ command: commandLine });
        const req = http.request(`${activeServerUrl}/api/cli/exec`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
            timeout: 15000,
        }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve({ success: parsed.success, output: parsed.output, isClear: parsed.isClear });
                } catch (e) {
                    resolve({ success: false, output: `Server error: ${body}` });
                }
            });
        });
        req.on('error', (err) => resolve({ success: false, output: `Could not reach server: ${err.message}` }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ success: false, output: 'Request to server timed out.' });
        });
        req.write(payload);
        req.end();
    });
}

/**
 * Execute command: uses live server if online, or local CliEngine if offline
 */
async function dispatchCommand(commandLineOrArgs) {
    let commandStr = '';
    if (Array.isArray(commandLineOrArgs)) {
        commandStr = commandLineOrArgs.map(a => {
            const s = String(a);
            return (s.includes(' ') || s.includes('\t')) ? `"${s.replace(/"/g, '\\"')}"` : s;
        }).join(' ');
    } else {
        commandStr = String(commandLineOrArgs || '');
    }

    const isOnline = await probeServer();
    if (isOnline) {
        return await execViaServer(commandStr);
    }
    const localEngine = new CliEngine();
    return await localEngine.execute(commandLineOrArgs);
}

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        return { globalToken: '', globalWebhookUrl: '', servers: [] };
    }
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
        return { globalToken: '', globalWebhookUrl: '', servers: [] };
    }
}

function saveConfig(data) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Open default web browser cross-platform
 */
function openBrowser(url) {
    try {
        const platform = process.platform;
        if (platform === 'win32') {
            exec(`start "" "${url}"`);
        } else if (platform === 'darwin') {
            exec(`open "${url}"`);
        } else if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
            exec(`xdg-open "${url}"`);
        }
    } catch (e) {}
}

/**
 * Cross-platform launcher to spin up the Web Dashboard server in a NEW terminal window.
 * If running on Windows, macOS, or Linux GUI, it opens a distinct terminal window so the server
 * output runs independently and does NOT block the current terminal.
 * If in headless Linux, Android Termux, or Docker, it launches as a detached background process
 * logging to logs/server.log so the current CLI continues interacting smoothly.
 */
function launchServerInNewTerminal() {
    const projectRoot = path.resolve(__dirname, '..');
    const serverScript = path.join(projectRoot, 'server.js');
    const platform = process.platform;
    const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
    const isTmux = Boolean(process.env.TMUX);

    // Ensure logs directory exists
    if (!fs.existsSync(LOGS_DIR)) {
        try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch (e) {}
    }

    // 1. Windows: Native CMD window
    if (platform === 'win32') {
        const winCmd = `start "AttendanceBot Web Server (Port ${SERVER_PORT})" cmd.exe /k "cd /d \"${projectRoot}\" && node server.js"`;
        exec(winCmd);
        return { type: 'new_window', mode: 'Windows CMD Window' };
    }

    // 2. macOS: Terminal.app AppleScript
    if (platform === 'darwin') {
        const appleScript = `tell application "Terminal" to do script "cd \\"${projectRoot}\\" && node server.js"`;
        exec(`osascript -e '${appleScript}'`);
        return { type: 'new_window', mode: 'macOS Terminal Window' };
    }

    // 3. Tmux session: New window
    if (isTmux) {
        try {
            exec(`tmux new-window -n "attendancebot-web" "cd '${projectRoot}' && node server.js"`);
            return { type: 'new_window', mode: 'tmux Window' };
        } catch (e) {}
    }

    // 4. Linux Desktop GUI: Try common desktop terminal emulators
    if (platform === 'linux' && hasDisplay) {
        const termEmulators = [
            { bin: 'x-terminal-emulator', args: `-T "AttendanceBot Web Server" -e "node '${serverScript}'"` },
            { bin: 'gnome-terminal', args: `--title="AttendanceBot Web Server" -- node "${serverScript}"` },
            { bin: 'konsole', args: `--new-tab -e node "${serverScript}"` },
            { bin: 'xfce4-terminal', args: `--title="AttendanceBot Web Server" -e "node '${serverScript}'"` },
            { bin: 'xterm', args: `-title "AttendanceBot Web Server" -e "node '${serverScript}'"` },
            { bin: 'alacritty', args: `-e node "${serverScript}"` },
            { bin: 'kitty', args: `node "${serverScript}"` }
        ];

        for (const t of termEmulators) {
            try {
                const check = execSync(`which ${t.bin} 2>/dev/null`).toString().trim();
                if (check) {
                    exec(`${t.bin} ${t.args}`, { cwd: projectRoot });
                    return { type: 'new_window', mode: `Linux ${t.bin}` };
                }
            } catch (e) {}
        }
    }

    // 5. Headless Linux / Android Termux / Docker / AI Studio container:
    // Detached background child process with stdout/stderr piped to logs/server.log
    const outStream = fs.openSync(SERVER_LOG_PATH, 'a');
    const child = spawn('node', ['server.js'], {
        cwd: projectRoot,
        detached: true,
        stdio: ['ignore', outStream, outStream],
    });
    child.unref();

    try {
        fs.writeFileSync(PID_PATH, String(child.pid), 'utf8');
    } catch (e) {}

    return { type: 'background', mode: 'Detached Background Daemon', pid: child.pid, logPath: SERVER_LOG_PATH };
}

/**
 * Stops the running web server if tracked by PID or listening on port
 */
async function stopWebServer() {
    console.log('\n⏳ Stopping AttendanceBot Web Server...');

    let stopped = false;
    if (fs.existsSync(PID_PATH)) {
        try {
            const pidStr = fs.readFileSync(PID_PATH, 'utf8').trim();
            const pid = parseInt(pidStr, 10);
            if (!isNaN(pid) && pid > 0) {
                process.kill(pid, 'SIGTERM');
                stopped = true;
            }
            fs.unlinkSync(PID_PATH);
        } catch (e) {}
    }

    // Also attempt killing via fuser / pkill on linux/mac if needed
    if (!stopped) {
        try {
            if (process.platform !== 'win32') {
                execSync(`fuser -k ${SERVER_PORT}/tcp 2>/dev/null || true`);
                stopped = true;
            }
        } catch (e) {}
    }

    // Wait a moment and check
    await new Promise((r) => setTimeout(r, 800));
    const stillOnline = await probeServer();
    if (!stillOnline) {
        console.log('✅ Web Dashboard server has been stopped.');
    } else {
        console.log('⚠️ Server process did not stop immediately. It may have been started externally.');
    }
}

/**
 * Displays recent lines from logs/server.log
 */
async function viewWebServerLogs() {
    console.clear();
    console.log('📋 --- Web Server Logs (logs/server.log) ---');
    if (!fs.existsSync(SERVER_LOG_PATH)) {
        console.log('No web server log file found yet (logs/server.log).');
    } else {
        try {
            const content = fs.readFileSync(SERVER_LOG_PATH, 'utf8');
            const lines = content.split('\n').filter(Boolean);
            const recent = lines.slice(-30);
            if (recent.length === 0) {
                console.log('(Log file is empty)');
            } else {
                recent.forEach((l) => console.log(l));
            }
        } catch (e) {
            console.log(`Failed to read log file: ${e.message}`);
        }
    }
    await ask('\nPress Enter to return...');
}

function printHeader(isOnline = false, statusData = null) {
    console.clear();
    console.log(`
███████╗████████╗████████╗███████╗███╗   ██╗██████╗  █████╗ ███╗   ██╗ ██████╗███████╗
██╔════╝╚══██╔══╝╚══██╔══╝██╔════╝████╗  ██║██╔══██╗██╔══██╗████╗  ██║██╔════╝██╔════╝
███████╗   ██║      ██║   █████╗  ██╔██╗ ██║██║  ██║███████║██╔██╗ ██║██║     █████╗  
╚════██║   ██║      ██║   ██╔══╝  ██║╚██╗██║██║  ██║██╔══██║██║╚██╗██║██║     ██╔══╝  
███████║   ██║      ██║   ███████╗██║ ╚████║██████╔╝██║  ██║██║ ╚████║╚██████╗███████╗
╚══════╝   ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═══╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝╚══════╝
  `);
    console.log(`⚡ AttendanceBot Management Hub • ${DISPLAY_VERSION}`);
    console.log('💡 Dual Interface: Interactive Terminal CLI & Web Dashboard');
    if (isOnline) {
        const daemonStatus = statusData?.status || 'UNKNOWN';
        const userTag = statusData?.user?.tag || (statusData?.user?.username ? `@${statusData.user.username}` : '');
        const daemonBadge = daemonStatus === 'RUNNING' ? `🟢 RUNNING (${userTag})` : `⚪ ${daemonStatus}`;
        console.log(`🌐 Web Dashboard  : 🟢 LIVE at ${SERVER_URL}`);
        console.log(`🤖 Discord Daemon : ${daemonBadge}`);
    } else {
        console.log(`🌐 Web Dashboard  : ⚪ OFFLINE (Local Standalone Engine Active)`);
        console.log(`🤖 Discord Daemon : Manage directly in CLI or spin Web Dashboard [W]`);
    }
    console.log('══════════════════════════════════════════════════════════════════════════════\n');
}

const WEEKDAYS = [
    { num: 0, name: 'Sunday', aliases: ['sun', 'sunday', '0', '7'] },
    { num: 1, name: 'Monday', aliases: ['mon', 'monday', '1'] },
    { num: 2, name: 'Tuesday', aliases: ['tue', 'tues', 'tuesday', '2'] },
    { num: 3, name: 'Wednesday', aliases: ['wed', 'weds', 'wednesday', '3'] },
    { num: 4, name: 'Thursday', aliases: ['thu', 'thur', 'thurs', 'thursday', '4'] },
    { num: 5, name: 'Friday', aliases: ['fri', 'friday', '5'] },
    { num: 6, name: 'Saturday', aliases: ['sat', 'saturday', '6'] },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseWeekday(input) {
    const key = (input || '').trim().toLowerCase();
    if (!key) return null;
    const match = WEEKDAYS.find((d) => d.aliases.includes(key));
    return match ? { num: match.num, name: match.name } : null;
}

function parseCalendarDate(input) {
    const key = (input || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d, 0, 0, 0, 0);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
        return null;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date < today) return null;
    return date;
}

function formatDateLabel(date) {
    return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function buildCronExpression(frequency, timeStr, specificDay = null, specificDate = null) {
    const [time, modifier] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);

    if (modifier && modifier.toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (modifier && modifier.toUpperCase() === 'AM' && hours === 12) hours = 0;

    if (specificDate) {
        const d = new Date(specificDate);
        return `${minutes} ${hours} ${d.getDate()} ${d.getMonth() + 1} *`;
    }
    if (specificDay !== null) {
        return `${minutes} ${hours} * * ${specificDay}`;
    }
    switch (frequency) {
        case '1': return `${minutes} ${hours} * * *`;
        case '2': return `${minutes} ${hours} * * 1-5`;
        case '3': return `${minutes} ${hours} * * 0,6`;
        default: return `${minutes} ${hours} * * *`;
    }
}

async function promptScheduleEntry(existingLabel = null) {
    console.log('\n  📅 --- Schedule Routine Builder ---');
    console.log('  [1] Everyday');
    console.log('  [2] Weekdays (Mon - Fri)');
    console.log('  [3] Weekends (Sat - Sun)');
    console.log('  [4] Specific Day of Week (e.g. Wednesday)');
    console.log('  [5] Specific One-Time Calendar Date (YYYY-MM-DD)');
    console.log('  [6] Custom 5-Part Cron Expression');

    const freq = await ask('  Select schedule type (1-6) [default: 2]: ') || '2';
    let cronExp = '0 9 * * 1-5';
    let label = existingLabel || 'Attendance Routine';
    let specificDate = null;

    if (freq === '6') {
        cronExp = await ask('  Enter standard 5-part cron syntax (e.g. "30 8 * * 1-5"): ');
        while (!cron.validate(cronExp)) {
            console.log('  ❌ Invalid cron expression syntax. Expected format: "minute hour day month day-of-week"');
            cronExp = await ask('  Enter standard 5-part cron syntax: ');
        }
        label = await ask('  Schedule label [default: Custom Schedule]: ') || 'Custom Schedule';
    } else if (freq === '5') {
        const dateStr = await ask('  Enter target date (YYYY-MM-DD): ');
        specificDate = parseCalendarDate(dateStr);
        const timeInput = await ask('  Enter time (e.g. 09:00 AM or 21:30) [default: 09:00 AM]: ') || '09:00 AM';
        cronExp = buildCronExpression(freq, timeInput, null, specificDate);
        label = specificDate ? `${timeInput} (${formatDateLabel(specificDate)})` : `One-Time ${timeInput}`;
    } else if (freq === '4') {
        const dayInput = await ask('  Enter day name (e.g. Monday, Friday): ');
        const dayObj = parseWeekday(dayInput) || { num: 1, name: 'Monday' };
        const timeInput = await ask('  Enter time (e.g. 09:00 AM or 21:30) [default: 09:00 AM]: ') || '09:00 AM';
        cronExp = buildCronExpression(freq, timeInput, dayObj.num, null);
        label = `${timeInput} (Every ${dayObj.name})`;
    } else {
        const timeInput = await ask('  Enter time (e.g. 09:00 AM or 21:30) [default: 09:00 AM]: ') || '09:00 AM';
        cronExp = buildCronExpression(freq, timeInput, null, null);
        const freqName = freq === '1' ? 'Everyday' : freq === '2' ? 'Weekdays' : 'Weekends';
        label = `${timeInput} (${freqName})`;
    }

    console.log('\n  Attendance Action Mode:');
    console.log('  [1] Text Message Check-in (e.g. "Present", "/attendance")');
    console.log('  [2] Emoji Reaction to Message (e.g. react 👍 to bot check-in prompt)');
    const modeChoice = await ask('  Select action mode (1-2) [default: 1]: ') || '1';

    let attendanceType = 'MESSAGE';
    let message = 'Present';
    let emoji = '👍';
    let targetMessageId = '';

    if (modeChoice === '2') {
        attendanceType = 'REACTION';
        emoji = await ask('  Enter reaction emoji (Unicode 👍 or custom) [default: 👍]: ') || '👍';
        targetMessageId = await ask('  Target Message ID (leave blank to react to newest message in channel): ');
    } else {
        message = await askMultiline('Present');
    }

    const jitter = await ask('  Max random delay in minutes (Anti-Detection) [default: 10]: ') || '10';

    return {
        id: Date.now().toString() + Math.floor(Math.random() * 1000),
        label,
        cron: cronExp,
        attendanceType,
        message,
        emoji,
        targetMessageId,
        maxJitterMinutes: parseInt(jitter, 10) || 10,
        active: true,
        ...(specificDate ? { type: 'ONCE', runDate: specificDate.toISOString() } : {}),
    };
}

/**
 * Interactive Add Server Wizard with Duplicate Profile Check & Redirect
 */
async function addServerWizard() {
    const isOnline = await probeServer();
    printHeader(isOnline, serverStatusData);
    console.log('➕ Add New Server Profile\n');

    const db = loadConfig();

    if (!db.globalToken) {
        db.globalToken = await ask('1. Enter your Discord User Token: ');
    } else {
        console.log(`🔑 Using configured Discord Token (${db.globalToken.substring(0, 10)}...)`);
        const change = await ask('   Do you want to change this token? (y/N): ');
        if (change.toLowerCase() === 'y') {
            db.globalToken = await ask('   Enter new Discord User Token: ');
        }
    }

    const name = await ask('\n2. Profile Name for this server (e.g. Work-DAO): ');
    const channelId = await ask('3. Target Discord Channel ID (Numeric snowflake): ');

    if (!name || !channelId) {
        console.log('\n❌ Server name and Channel ID are both required.');
        await ask('\nPress Enter to return to main menu...');
        return;
    }

    // Duplicate Check: Check if server name or channel ID already exists!
    const cleanChan = channelId.trim();
    const cleanName = name.trim().toLowerCase();
    const existingServer = db.servers.find(
        (s) => (s.channelId && s.channelId.trim() === cleanChan) ||
               (s.name && s.name.trim().toLowerCase() === cleanName)
    );

    if (existingServer) {
        console.log(`\n⚠️ DUPLICATE DETECTED: Server profile "${existingServer.name}" already exists!`);
        console.log(`   Channel ID : ${existingServer.channelId}`);
        console.log(`   Server ID  : ${existingServer.id}`);
        console.log(`   Schedules  : ${(existingServer.schedules || []).length} configured`);
        console.log('\n↪️ REDIRECT: Would you like to add a new schedule routine to this existing server instead?');

        const redirect = await ask('   Redirect to Add Schedule for this server? (Y/n): ');
        if (redirect.toLowerCase() !== 'n') {
            await addScheduleWizardForServer(existingServer);
            return;
        } else {
            console.log('\nOperation cancelled. Returning to main menu.');
            await ask('\nPress Enter to return...');
            return;
        }
    }

    const customWebhook = await ask('4. Custom Webhook URL for this server (leave blank to use global): ');

    // Collect initial schedule(s)
    const schedules = [];
    schedules.push(await promptScheduleEntry());

    while (true) {
        const more = await ask('\nAdd another schedule routine to this server profile? (y/N): ');
        if (more.toLowerCase() === 'y') {
            schedules.push(await promptScheduleEntry());
        } else {
            break;
        }
    }

    const newServer = {
        id: Date.now().toString(),
        name: name.trim(),
        channelId: cleanChan,
        webhookUrl: customWebhook ? customWebhook.trim() : '',
        active: true,
        schedules
    };

    db.servers.push(newServer);
    saveConfig(db);

    console.log(`\n🎉 Server Profile "${newServer.name}" created successfully with ${schedules.length} schedule routine(s)!`);
    console.log(`Server ID: ${newServer.id} | Channel ID: ${newServer.channelId}`);

    if (isOnline) {
        await dispatchCommand('restart');
    }

    await ask('\nPress Enter to return to main menu...');
}

/**
 * Add a schedule directly to an existing server profile
 */
async function addScheduleWizardForServer(srv) {
    const isOnline = await probeServer();
    printHeader(isOnline, serverStatusData);
    console.log(`📅 Add Schedule Routine to Server: "${srv.name}" (Channel: ${srv.channelId})\n`);

    const newSched = await promptScheduleEntry();

    if (!srv.schedules) srv.schedules = [];
    srv.schedules.push(newSched);

    const db = loadConfig();
    const idx = db.servers.findIndex(s => String(s.id) === String(srv.id));
    if (idx >= 0) {
        db.servers[idx] = srv;
        saveConfig(db);
    }

    console.log(`\n✅ Added schedule "${newSched.label}" to server "${srv.name}"!`);
    console.log(`Cron: "${newSched.cron}" | Mode: ${newSched.attendanceType} | Anti-Detection Delay: ${newSched.maxJitterMinutes}m`);

    if (isOnline) {
        await dispatchCommand('restart');
    }

    await ask('\nPress Enter to continue...');
}

/**
 * Interactive Server Profile Manager
 */
async function manageServerMenu() {
    while (true) {
        const isOnline = await probeServer();
        printHeader(isOnline, serverStatusData);

        const res = await dispatchCommand('list');
        console.log(res.output);

        console.log('\nServer Management Actions:');
        console.log('  [e] Edit Server Details (Name, Channel ID, Webhook)');
        console.log('  [p] Pause a Server (Temporarily halts check-ins)');
        console.log('  [r] Resume a Server');
        console.log('  [d] Delete a Server');
        console.log('  [s] Manage Schedules on a Server');
        console.log('  [t] Trigger Immediate Test Check-in');
        console.log('  [b] Return to Main Menu');

        const action = (await ask('\nChoose action (e/p/r/d/s/t/b): ')).toLowerCase();
        if (action === 'b' || !action) break;

        if (action === 'e') {
            const id = await ask('Enter Server ID or Name to edit: ');
            const db = loadConfig();
            const srv = db.servers.find(s => String(s.id) === id || s.name.toLowerCase() === id.toLowerCase());
            if (!srv) {
                console.log(`❌ Server "${id}" not found.`);
            } else {
                console.log(`\nEditing Server: "${srv.name}" (Leave blank to keep current value)`);
                const newName = await ask(`New Name [${srv.name}]: `);
                const newChan = await ask(`New Channel ID [${srv.channelId}]: `);
                const newHook = await ask(`New Webhook [${srv.webhookUrl || 'None'}]: `);

                if (newName) srv.name = newName.trim();
                if (newChan) srv.channelId = newChan.trim();
                if (newHook) srv.webhookUrl = newHook.trim() === '-' ? '' : newHook.trim();

                saveConfig(db);
                console.log(`✅ Server "${srv.name}" updated successfully.`);
            }
            await ask('\nPress Enter to continue...');
        } else if (action === 'p') {
            const id = await ask('Enter Server ID or Name to pause: ');
            const r = await dispatchCommand(`server pause "${id}"`);
            console.log(r.output);
            await ask('\nPress Enter to continue...');
        } else if (action === 'r') {
            const id = await ask('Enter Server ID or Name to resume: ');
            const r = await dispatchCommand(`server resume "${id}"`);
            console.log(r.output);
            await ask('\nPress Enter to continue...');
        } else if (action === 'd') {
            const id = await ask('Enter Server ID or Name to delete: ');
            const confirm = await ask(`⚠️ Confirm permanent deletion of server "${id}"? (y/N): `);
            if (confirm.toLowerCase() === 'y') {
                const r = await dispatchCommand(`server delete "${id}"`);
                console.log(r.output);
            }
            await ask('\nPress Enter to continue...');
        } else if (action === 's') {
            const id = await ask('Enter Server ID or Name to manage schedules: ');
            const db = loadConfig();
            const srv = db.servers.find(s => String(s.id) === id || s.name.toLowerCase() === id.toLowerCase());
            if (!srv) {
                console.log(`❌ Server "${id}" not found.`);
                await ask('\nPress Enter to continue...');
            } else {
                await serverSchedulesSubMenu(srv);
            }
        } else if (action === 't') {
            const id = await ask('Enter Server ID or Name to trigger check-in: ');
            const r = await dispatchCommand(`trigger "${id}"`);
            console.log(r.output);
            await ask('\nPress Enter to continue...');
        }
    }
}

/**
 * Schedule Sub-Menu for a specific server
 */
async function serverSchedulesSubMenu(srv) {
    while (true) {
        const isOnline = await probeServer();
        printHeader(isOnline, serverStatusData);

        const db = loadConfig();
        const currentSrv = db.servers.find(s => String(s.id) === String(srv.id)) || srv;
        const scheds = currentSrv.schedules || [];

        console.log(`📅 Schedule Routines for Server: "${currentSrv.name}" (ID: ${currentSrv.id})`);
        console.log('─────────────────────────────────────────────────────────────');
        if (scheds.length === 0) {
            console.log('  No schedules configured for this server.');
        } else {
            scheds.forEach((sc, i) => {
                const state = sc.active ? '🟢 ACTIVE' : '⚪ PAUSED';
                const typeDesc = sc.attendanceType === 'REACTION' ? `Reaction (${sc.emoji})` : `Message ("${(sc.message || '').substring(0, 20)}...")`;
                console.log(`  [#${i + 1}] [${state}] ID: ${sc.id} | "${sc.label}"`);
                console.log(`       Cron: "${sc.cron}" | Mode: ${typeDesc} | Jitter: ${sc.maxJitterMinutes || 0}m`);
            });
        }
        console.log('─────────────────────────────────────────────────────────────');

        console.log('\nSchedule Actions:');
        console.log('  [a] Add New Schedule');
        console.log('  [t] Toggle Schedule (Active / Paused)');
        console.log('  [d] Delete a Schedule');
        console.log('  [r] Reorder Schedules (Change Priority)');
        console.log('  [b] Back to Servers');

        const act = (await ask('\nSelect action (a/t/d/r/b): ')).toLowerCase();
        if (act === 'b' || !act) break;

        if (act === 'a') {
            await addScheduleWizardForServer(currentSrv);
        } else if (act === 't') {
            const schedId = await ask('Enter Schedule ID or # number to toggle: ');
            let targetId = schedId;
            const num = parseInt(schedId, 10);
            if (!isNaN(num) && num >= 1 && num <= scheds.length) {
                targetId = scheds[num - 1].id;
            }
            const r = await dispatchCommand(`schedule toggle "${currentSrv.id}" "${targetId}"`);
            console.log(r.output);
            await ask('\nPress Enter to continue...');
        } else if (act === 'd') {
            const schedId = await ask('Enter Schedule ID or # number to delete: ');
            let targetId = schedId;
            const num = parseInt(schedId, 10);
            if (!isNaN(num) && num >= 1 && num <= scheds.length) {
                targetId = scheds[num - 1].id;
            }
            const confirm = await ask(`⚠️ Confirm deletion of schedule "${targetId}"? (y/N): `);
            if (confirm.toLowerCase() === 'y') {
                const r = await dispatchCommand(`schedule delete "${currentSrv.id}" "${targetId}"`);
                console.log(r.output);
            }
            await ask('\nPress Enter to continue...');
        } else if (act === 'r') {
            console.log('\nEnter schedule IDs or numbers in the new desired order (comma-separated):');
            console.log('Example: 2, 1, 3');
            const orderInput = await ask('> ');
            if (orderInput) {
                const parts = orderInput.split(',').map(s => s.trim()).filter(Boolean);
                const resolvedIds = parts.map(p => {
                    const n = parseInt(p, 10);
                    if (!isNaN(n) && n >= 1 && n <= scheds.length) {
                        return scheds[n - 1].id;
                    }
                    return p;
                });
                const r = await dispatchCommand(`schedule reorder "${currentSrv.id}" "${resolvedIds.join(',')}"`);
                console.log(r.output);
            }
            await ask('\nPress Enter to continue...');
        }
    }
}

/**
 * Universal Daemon Action (Online or Standalone)
 */
async function toggleDaemonAction() {
    const isOnline = await probeServer();
    printHeader(isOnline, serverStatusData);

    const st = isOnline ? (serverStatusData?.status || 'STOPPED') : 'STANDALONE';
    console.log(`Current Mode: ${isOnline ? `Web Server Online (Daemon: ${st})` : 'Offline Standalone Engine'}\n`);

    console.log('Daemon Management Options:');
    console.log('  [1] Start / Resume Attendance Daemon');
    console.log('  [2] Stop / Pause Attendance Daemon');
    console.log('  [3] Restart Attendance Daemon');
    console.log('  [4] PM2 Background Service Control');
    console.log('  [b] Return');

    const choice = await ask('\nSelect option (1-4, or b): ');
    if (choice === '1') {
        console.log('⏳ Starting daemon...');
        const r = await dispatchCommand('start');
        console.log(r.output);
    } else if (choice === '2') {
        console.log('⏳ Stopping daemon...');
        const r = await dispatchCommand('stop');
        console.log(r.output);
    } else if (choice === '3') {
        console.log('⏳ Restarting daemon...');
        const r = await dispatchCommand('restart');
        console.log(r.output);
    } else if (choice === '4') {
        await pm2ServiceMenu();
        return;
    }

    await ask('\nPress Enter to continue...');
}

/**
 * PM2 Background Service Menu
 */
async function pm2ServiceMenu() {
    const isOnline = await probeServer();
    printHeader(isOnline, serverStatusData);
    console.log('⚙️ PM2 Background Service Manager\n');
    console.log('  [1] Check PM2 Service Status');
    console.log('  [2] Install / Start Service via PM2 (npm run service:install)');
    console.log('  [3] Uninstall / Stop Service via PM2 (npm run service:uninstall)');
    console.log('  [4] View PM2 Background Logs');
    console.log('  [b] Return');

    const ch = await ask('\nSelect option (1-4, or b): ');
    if (ch === '1') {
        const r = await dispatchCommand('service status');
        console.log(r.output);
    } else if (ch === '2') {
        console.log('Installing and starting background PM2 service...');
        const r = await dispatchCommand('service install');
        console.log(r.output);
    } else if (ch === '3') {
        console.log('Stopping and uninstalling background PM2 service...');
        const r = await dispatchCommand('service uninstall');
        console.log(r.output);
    } else if (ch === '4') {
        const r = await dispatchCommand('service logs');
        console.log(r.output);
    }
    await ask('\nPress Enter to continue...');
}

/**
 * Configuration Import & Export Menu with Schema Validation
 */
async function exportImportMenu() {
    const isOnline = await probeServer();
    printHeader(isOnline, serverStatusData);
    console.log('📦 Configuration Backup & JSON Import (Schema-Validated)\n');
    console.log('  [1] Export Current Configuration to JSON File');
    console.log('  [2] Import Configuration from JSON File (Strict Schema Check)');
    console.log('  [3] Validate a JSON Configuration File');
    console.log('  [b] Return');

    const ch = await ask('\nSelect option (1-3, or b): ');
    if (ch === '1') {
        const defaultFilename = `attendancebot-config-${Date.now()}.json`;
        const targetFile = await ask(`Enter target file path [default: ${defaultFilename}]: `) || defaultFilename;
        const config = loadConfig();
        const exportPayload = {
            app: 'AttendanceBot',
            version: VERSION,
            exportedAt: new Date().toISOString(),
            globalWebhookUrl: config.globalWebhookUrl || '',
            servers: config.servers || []
        };
        fs.writeFileSync(path.resolve(process.cwd(), targetFile), JSON.stringify(exportPayload, null, 2), 'utf8');
        console.log(`\n✅ Configuration successfully exported to: ${path.resolve(process.cwd(), targetFile)}`);
        console.log(`Exported ${exportPayload.servers.length} server profiles.`);
        await ask('\nPress Enter to continue...');
    } else if (ch === '2') {
        const filePath = await ask('Enter path to JSON configuration file: ');
        if (!filePath) {
            console.log('No file specified.');
            await ask('\nPress Enter to continue...');
            return;
        }

        const resolved = path.resolve(process.cwd(), filePath);
        if (!fs.existsSync(resolved)) {
            console.log(`❌ File not found: ${filePath}`);
            await ask('\nPress Enter to continue...');
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
        } catch (err) {
            console.log(`❌ JSON Parse Error: ${err.message}`);
            await ask('\nPress Enter to continue...');
            return;
        }

        // Run Schema Validation!
        console.log('\n🔍 Validating JSON schema structure...');
        const validation = validateConfigSchema(parsed);

        if (!validation.isValid) {
            console.log(`\n❌ SCHEMA VALIDATION FAILED (${validation.errors.length} issue(s) detected):`);
            validation.errors.forEach((err, idx) => {
                console.log(`   ${idx + 1}. ${err}`);
            });
            if (validation.warnings.length > 0) {
                console.log('\n⚠️ Warnings:');
                validation.warnings.forEach(w => console.log(`   • ${w}`));
            }
            console.log('\nImport aborted. Please fix the schema errors above in your JSON file and try again.');
            await ask('\nPress Enter to continue...');
            return;
        }

        console.log(`\n✅ Schema Verification PASSED!`);
        console.log(`   • Server Profiles Verified : ${validation.stats.serverCount}`);
        console.log(`   • Total Schedules Verified : ${validation.stats.scheduleCount}`);
        if (validation.warnings.length > 0) {
            console.log('\n⚠️ Warnings:');
            validation.warnings.forEach(w => console.log(`   • ${w}`));
        }

        console.log('\nChoose Import Method:');
        console.log('  [1] Merge with existing profiles (Append / Update)');
        console.log('  [2] Replace all existing profiles entirely');
        const modeChoice = await ask('Select method (1-2) [default: 1]: ') || '1';
        const mode = modeChoice === '2' ? 'replace' : 'merge';

        const confirm = await ask(`Proceed with ${mode.toUpperCase()} import? (Y/n): `);
        if (confirm.toLowerCase() === 'n') {
            console.log('Import cancelled.');
            await ask('\nPress Enter to continue...');
            return;
        }

        const r = await dispatchCommand(`import "${filePath}" ${mode}`);
        console.log(`\n${r.output}`);
        await ask('\nPress Enter to continue...');
    } else if (ch === '3') {
        const filePath = await ask('Enter path to JSON file to validate: ');
        if (filePath) {
            const r = await dispatchCommand(`validate "${filePath}"`);
            console.log(`\n${r.output}`);
        }
        await ask('\nPress Enter to continue...');
    }
}

async function triggerTaskAction() {
    const isOnline = await probeServer();
    printHeader(isOnline, serverStatusData);

    const res = await dispatchCommand('list');
    console.log(res.output);

    const srvId = await ask('\nEnter Server ID or Name to trigger check-in immediately: ');
    if (!srvId) return;

    console.log(`\n⚡ Executing attendance task on "${srvId}"...`);
    const r = await dispatchCommand(`trigger "${srvId}"`);
    console.log(r.output);

    await ask('\nPress Enter to continue...');
}

async function viewLogsAction() {
    const isOnline = await probeServer();
    printHeader(isOnline, serverStatusData);

    console.log('📋 Attendance Activity Logs\n');
    const count = await ask('Number of log entries to display [default: 20]: ') || '20';
    const r = await dispatchCommand(`logs ${count}`);
    console.log(`\n${r.output}`);

    await ask('\nPress Enter to continue...');
}

async function updateCredentialsAction() {
    const isOnline = await probeServer();
    printHeader(isOnline, serverStatusData);

    console.log('🔑 Credentials & Webhook Setup\n');
    console.log('  [1] Update Discord User Token');
    console.log('  [2] Update Global Discord Webhook URL');
    console.log('  [3] Test Current Webhook Notification');
    console.log('  [4] Return');

    const choice = await ask('\nSelect option (1-4): ');
    if (choice === '1') {
        const token = await ask('Enter new Discord User Token: ');
        if (token) {
            const r = await dispatchCommand(`token "${token}"`);
            console.log(r.output);
        }
    } else if (choice === '2') {
        const url = await ask('Enter Global Webhook URL: ');
        if (url) {
            const r = await dispatchCommand(`webhook "${url}"`);
            console.log(r.output);
        }
    } else if (choice === '3') {
        console.log('📡 Testing webhook notification...');
        const r = await dispatchCommand('webhook test');
        console.log(r.output);
    }

    await ask('\nPress Enter to continue...');
}

async function interactiveRepl() {
    const isOnline = await probeServer();
    printHeader(isOnline, serverStatusData);
    console.log('💻 Interactive CLI Command Console (REPL)');
    console.log('Type any CLI command directly (e.g. "status", "list", "server add ...", "trigger ...", "import ...", "help").');
    console.log('Type "exit" or "menu" to return to main menu.\n');

    while (true) {
        const cmd = await ask('attendancebot:~$ ');
        const trimmed = cmd.trim();
        if (!trimmed) continue;
        if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'menu' || trimmed.toLowerCase() === 'quit') {
            break;
        }

        const res = await dispatchCommand(trimmed);
        if (res.isClear) {
            console.clear();
        } else {
            console.log(res.output);
        }
        console.log('');
    }
}

/**
 * Spawns the web server in a separate terminal window and gives instant feedback
 */
async function spinUpServerWorkflow() {
    const isOnline = await probeServer();
    if (isOnline) {
        console.log(`\n✅ The Web Dashboard server is ALREADY spinning live at ${SERVER_URL}!`);
        const openNow = await ask('Open dashboard in your web browser? (Y/n): ');
        if (openNow.toLowerCase() !== 'n') {
            openBrowser(SERVER_URL);
        }
        await ask('\nPress Enter to return to menu...');
        return;
    }

    console.log('\n🚀 Launching AttendanceBot Web Dashboard on a new terminal window...');
    const result = launchServerInNewTerminal();

    console.log(`   Launcher: ${result.mode || result.type}`);
    console.log('⏳ Waiting for server to initialize...');

    let attempts = 0;
    while (attempts < 12) {
        await new Promise((r) => setTimeout(r, 600));
        const up = await probeServer();
        if (up) {
            console.log(`\n🎉 Web Server is ONLINE and spinning at ${SERVER_URL}!`);
            console.log('   The server runs independently in its own window/process.');
            console.log('   You can continue interacting with this CLI console freely.');
            openBrowser(SERVER_URL);
            await ask('\nPress Enter to continue in CLI...');
            return;
        }
        attempts++;
    }

    console.log(`\n⚠️ Web server process dispatched. Check ${SERVER_URL} shortly or view logs with option [L].`);
    await ask('\nPress Enter to return to menu...');
}

async function mainMenu() {
    while (true) {
        const isOnline = await probeServer();
        printHeader(isOnline, serverStatusData);

        console.log('  --- INTERACTIVE CLI MANAGEMENT ---');
        console.log('  [1] View All Configurations & Daemon Status');
        console.log('  [2] Add New Server Profile (Wizard with Duplicate Check)');
        console.log('  [3] Manage Servers (Edit, Pause, Resume, Delete, List)');
        console.log('  [4] Manage Schedule Routines (Add, Edit, Reorder, Pause, Delete)');
        console.log('  [5] Attendance Daemon Controls (Start, Stop, Restart)');
        console.log('  [6] PM2 Background Service (Install, Uninstall, Status, PM2 Logs)');
        console.log('  [7] Trigger Attendance Check-in Now (Instant Test Run)');
        console.log('  [8] Configuration Backup & Import (Strict Schema Validation)');
        console.log('  [9] Live Activity Logs (Terminal Stream)');
        console.log('  [10] Discord Credentials & Notification Webhook Setup');
        console.log('  [C] Interactive Command Console (REPL)');
        console.log('');
        console.log('  --- WEB DASHBOARD CONTROLS ---');
        console.log(`  [W] Spin Up Web Dashboard (Separate Window / Background)`);
        console.log(`  [O] Open Web Dashboard in Browser (${SERVER_URL})`);
        console.log(`  [K] Stop Web Dashboard Server`);
        console.log(`  [L] View Web Server Output Logs`);
        console.log('');
        console.log('  [Q] Exit CLI');
        console.log('══════════════════════════════════════════════════════════════════════════════');

        const choice = (await ask('Select an option: ')).toLowerCase();

        if (choice === '1') {
            const r = await dispatchCommand('status');
            console.log(r.output);
            const r2 = await dispatchCommand('list');
            console.log(r2.output);
            await ask('\nPress Enter to return to main menu...');
        } else if (choice === '2') {
            await addServerWizard();
        } else if (choice === '3') {
            await manageServerMenu();
        } else if (choice === '4') {
            const db = loadConfig();
            if (db.servers.length === 0) {
                console.log('\n⚠️ No server profiles exist yet. Create a server first with option [2].');
                await ask('\nPress Enter to continue...');
            } else if (db.servers.length === 1) {
                await serverSchedulesSubMenu(db.servers[0]);
            } else {
                console.log('\nSelect server to manage schedules:');
                db.servers.forEach((s, idx) => {
                    console.log(`  [${idx + 1}] "${s.name}" (Channel: ${s.channelId})`);
                });
                const pick = await ask('\nSelect server (1-' + db.servers.length + '): ');
                const n = parseInt(pick, 10);
                if (!isNaN(n) && n >= 1 && n <= db.servers.length) {
                    await serverSchedulesSubMenu(db.servers[n - 1]);
                }
            }
        } else if (choice === '5') {
            await toggleDaemonAction();
        } else if (choice === '6') {
            await pm2ServiceMenu();
        } else if (choice === '7') {
            await triggerTaskAction();
        } else if (choice === '8') {
            await exportImportMenu();
        } else if (choice === '9') {
            await viewLogsAction();
        } else if (choice === '10') {
            await updateCredentialsAction();
        } else if (choice === 'c') {
            await interactiveRepl();
        } else if (choice === 'w') {
            await spinUpServerWorkflow();
        } else if (choice === 'o') {
            openBrowser(SERVER_URL);
            console.log(`\n🌐 Opened ${SERVER_URL} in your browser.`);
            await ask('\nPress Enter to continue...');
        } else if (choice === 'k') {
            await stopWebServer();
            await ask('\nPress Enter to continue...');
        } else if (choice === 'l') {
            await viewWebServerLogs();
        } else if (choice === 'q') {
            console.log('\n👋 Exiting AttendanceBot CLI. Your background daemon and schedules will keep running. Goodbye!\n');
            rl.close();
            process.exit(0);
        }
    }
}

/**
 * Initial startup selector when server is offline
 */
async function promptStartupMode() {
    console.clear();
    console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║               ⚡ Welcome to AttendanceBot Management Hub (${DISPLAY_VERSION})            ║
║                  Dual Interface: Interactive CLI & Web Dashboard             ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
    console.log('How would you like to manage AttendanceBot today?\n');
    console.log('  [1] Interactive Terminal CLI (Default: manage profiles, schedules & daemon here)');
    console.log(`  [2] Launch Web Dashboard in a New Terminal Window (http://localhost:${SERVER_PORT})`);
    console.log('  [3] Dual Mode (Spin Web Server in new window + Continue in Terminal CLI)\n');

    const choice = await ask('Select management mode (1-3) [default: 1]: ') || '1';

    if (choice === '2') {
        console.log('\n🚀 Launching AttendanceBot Web Server in a new window...');
        launchServerInNewTerminal();
        console.log('⏳ Waiting for server to initialize...');
        let attempts = 0;
        while (attempts < 10) {
            await new Promise((r) => setTimeout(r, 600));
            if (await probeServer()) {
                console.log(`\n🎉 Web Server is ONLINE at ${SERVER_URL}!`);
                openBrowser(SERVER_URL);
                console.log('You can open this CLI anytime in a terminal: npm run cli');
                rl.close();
                process.exit(0);
                return;
            }
            attempts++;
        }
        openBrowser(SERVER_URL);
        console.log(`\nServer process initiated. Access dashboard at: ${SERVER_URL}`);
        rl.close();
        process.exit(0);
        return;
    } else if (choice === '3') {
        console.log('\n🚀 Spinning up Web Server in a new window for Dual Management...');
        launchServerInNewTerminal();
        let attempts = 0;
        while (attempts < 8) {
            await new Promise((r) => setTimeout(r, 600));
            if (await probeServer()) {
                openBrowser(SERVER_URL);
                break;
            }
            attempts++;
        }
        // Seamlessly continue into CLI main menu
        await mainMenu();
        return;
    }

    // Default option 1: Enter CLI main menu
    await mainMenu();
}

/**
 * Main entry: Direct command execution or interactive menu
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length > 0) {
        // Direct command execution from terminal!
        // e.g. attendanceBot status, attendanceBot list, attendanceBot start, attendanceBot import config.json
        const res = await dispatchCommand(args);
        console.log(res.output);
        process.exit(res.success ? 0 : 1);
        return;
    }

    // Interactive Mode
    const isOnline = await probeServer();
    if (!isOnline) {
        await promptStartupMode();
    } else {
        await mainMenu();
    }
}

main().catch((err) => {
    console.error(`Fatal CLI error: ${err.message}`);
    process.exit(1);
});
