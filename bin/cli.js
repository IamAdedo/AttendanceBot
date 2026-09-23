#!/usr/bin/env node

/**
 * bin/cli.js
 *
 * AttendanceBot Interactive and Command-Line Management Interface.
 *
 * Supports:
 * 1. Managing while the web server is spinning (connects over HTTP API to localhost:3000).
 * 2. Standalone offline mode when the server is not running (direct local config & engine).
 * 3. Direct CLI argument execution: `attendanceBot status`, `attendanceBot list`, `attendanceBot start`, etc.
 * 4. Interactive menu wizard & interactive CLI REPL shell.
 * 5. Spinning up the web dashboard server from CLI.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const CliEngine = require('../src/cliEngine');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const SERVER_PORT = process.env.PORT || 3000;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

let serverOnline = false;
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
 * Fast probe to see if AttendanceBot Web Server is online
 */
function probeServer() {
    return new Promise((resolve) => {
        const req = http.get(`${SERVER_URL}/api/status`, { timeout: 1200 }, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                let body = '';
                res.on('data', (c) => { body += c; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        serverStatusData = parsed;
                        resolve(true);
                    } catch (e) {
                        resolve(false);
                    }
                });
            } else {
                resolve(false);
            }
        });
        req.on('error', () => resolve(false));
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
        const req = http.request(`${SERVER_URL}/api/cli/exec`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
            timeout: 10000,
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

function printHeader(isOnline = false, statusData = null) {
    console.clear();
    console.log(`
██╗     ██████╗ ███████╗
██║     ╚════██╗██╔════╝
██║      █████╔╝█████╗
██║     ██╔═══╝ ██╔══╝
███████╗███████╗███████╗
╚══════╝╚══════╝╚══════╝
  `);
    console.log('⚡ AttendanceBot CLI Manager');
    if (isOnline) {
        const daemonStatus = statusData?.status || 'UNKNOWN';
        const userTag = statusData?.user?.tag || (statusData?.user?.username ? `@${statusData.user.username}` : '');
        const daemonBadge = daemonStatus === 'RUNNING' ? `🟢 DAEMON RUNNING (${userTag})` : `⚪ DAEMON ${daemonStatus}`;
        console.log(`🌐 Server Mode : 🟢 LIVE at ${SERVER_URL}`);
        console.log(`🤖 Status      : ${daemonBadge}`);
    } else {
        console.log(`🌐 Server Mode : ⚪ OFFLINE (Local Standalone Mode)`);
        console.log(`💡 Tip         : You can spin the web server anytime with option [S]`);
    }
    console.log('══════════════════════════════════════════════════\n');
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

function isValidTime(input) {
    const [time, modifier] = (input || '').trim().split(/\s+/);
    if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return false;
    const [h, m] = time.split(':').map(Number);
    if (m < 0 || m > 59) return false;
    if (modifier) {
        const mod = modifier.toUpperCase();
        if (mod !== 'AM' && mod !== 'PM') return false;
        return h >= 1 && h <= 12;
    }
    return h >= 0 && h <= 23;
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

async function promptScheduleEntry(frequency, dayName = null, specificDate = null) {
    const timeInput = await ask('  Enter time (e.g., 09:00 AM or 21:30) [default: 09:00 AM]: ') || '09:00 AM';
    const message = await askMultiline('Present');
    const jitter = await ask('  Max random delay in minutes (Anti-Detection) [default: 10]: ') || '10';

    const cron = buildCronExpression(frequency, timeInput, dayName !== null ? dayName.num : null, specificDate);
    const label = specificDate
        ? `${timeInput} (${formatDateLabel(specificDate)})`
        : dayName
            ? `${timeInput} (${dayName.name})`
            : `${timeInput} (${frequency === '1' ? 'Everyday' : frequency === '2' ? 'Weekdays' : 'Weekends'})`;

    return {
        id: Date.now().toString() + Math.floor(Math.random() * 1000),
        label,
        cron,
        attendanceType: 'MESSAGE',
        message,
        emoji: '👍',
        targetMessageId: '',
        maxJitterMinutes: parseInt(jitter, 10) || 10,
        active: true,
        ...(specificDate ? { type: 'ONCE', runDate: specificDate.toISOString() } : {}),
    };
}

async function promptSchedules() {
    console.log('\n  📅 --- Schedule Builder ---');
    console.log('  [1] Everyday');
    console.log('  [2] Weekdays (Mon - Fri)');
    console.log('  [3] Weekends (Sat - Sun)');

    const freq = await ask('  Select frequency (1-3) [default: 2]: ') || '2';
    return [await promptScheduleEntry(freq)];
}

async function addServerWizard() {
    const isOnline = await probeServer();
    printHeader(isOnline, serverStatusData);
    console.log('➕ Add New Server Configuration\n');

    const db = loadConfig();

    if (!db.globalToken) {
        db.globalToken = await ask('1. Enter your Discord User Token: ');
    } else {
        console.log(`🔑 Using saved Discord Token (${db.globalToken.substring(0, 10)}...)`);
        const change = await ask('   Do you want to change this token? (y/N): ');
        if (change.toLowerCase() === 'y') {
            db.globalToken = await ask('   Enter new Discord User Token: ');
        }
    }

    const name = await ask('\n2. Profile Name for this server (e.g. Work-DAO): ');
    const channelId = await ask('3. Target Channel ID: ');
    const customWebhook = await ask('4. Custom Webhook URL for this server (Press Enter to use global): ');

    const schedules = await promptSchedules();

    const newServer = {
        id: Date.now().toString(),
        name,
        channelId,
        webhookUrl: customWebhook || '',
        active: true,
        schedules
    };

    if (isOnline) {
        // Create via server API so daemon reloads immediately
        const res = await dispatchCommand(`server add "${name}" ${channelId} "${schedules[0].cron}" "${schedules[0].message}"`);
        console.log(`\n${res.output}`);
    } else {
        db.servers.push(newServer);
        saveConfig(db);
        console.log(`\n🎉 Server Profile "${name}" created successfully with ${schedules.length} schedule(s)!`);
    }

    await ask('\nPress Enter to return to main menu...');
}

async function manageServerMenu() {
    const isOnline = await probeServer();
    printHeader(isOnline, serverStatusData);

    const res = await dispatchCommand('list');
    console.log(res.output);

    console.log('\nQuick Actions:');
    console.log('  [p] Pause a Server (server pause <id>)');
    console.log('  [r] Resume a Server (server resume <id>)');
    console.log('  [d] Delete a Server (server delete <id>)');
    console.log('  [t] Trigger Check-in Now (trigger <id>)');
    console.log('  [b] Return to Main Menu');

    const action = (await ask('\nChoose action or type full command: ')).toLowerCase();
    if (action === 'b' || !action) return;

    if (action === 'p') {
        const id = await ask('Enter Server ID or Name to pause: ');
        const r = await dispatchCommand(`server pause "${id}"`);
        console.log(r.output);
    } else if (action === 'r') {
        const id = await ask('Enter Server ID or Name to resume: ');
        const r = await dispatchCommand(`server resume "${id}"`);
        console.log(r.output);
    } else if (action === 'd') {
        const id = await ask('Enter Server ID or Name to delete: ');
        const confirm = await ask(`⚠️ Confirm deletion of "${id}"? (y/N): `);
        if (confirm.toLowerCase() === 'y') {
            const r = await dispatchCommand(`server delete "${id}"`);
            console.log(r.output);
        }
    } else if (action === 't') {
        const id = await ask('Enter Server ID or Name to trigger: ');
        const r = await dispatchCommand(`trigger "${id}"`);
        console.log(r.output);
    } else {
        const r = await dispatchCommand(action);
        console.log(r.output);
    }

    await ask('\nPress Enter to continue...');
}

async function toggleDaemonAction() {
    const isOnline = await probeServer();
    if (!isOnline) {
        console.log('\n⚠️ The Web Server is currently offline. Start the server first with option [S].');
        await ask('\nPress Enter to continue...');
        return;
    }

    const st = serverStatusData?.status || 'STOPPED';
    console.log(`\nCurrent Daemon Status: ${st}`);

    if (st === 'RUNNING') {
        const confirm = await ask('Stop the daemon? (y/N): ');
        if (confirm.toLowerCase() === 'y') {
            const r = await dispatchCommand('stop');
            console.log(r.output);
        }
    } else {
        const confirm = await ask('Start the daemon? (Y/n): ');
        if (confirm.toLowerCase() !== 'n') {
            const r = await dispatchCommand('start');
            console.log(r.output);
        }
    }

    await ask('\nPress Enter to continue...');
}

async function triggerTaskAction() {
    const isOnline = await probeServer();
    printHeader(isOnline, serverStatusData);

    const res = await dispatchCommand('list');
    console.log(res.output);

    const srvId = await ask('\nEnter Server ID or Name to trigger immediately: ');
    if (!srvId) return;

    console.log(`\n⚡ Executing attendance task on "${srvId}"...`);
    const r = await dispatchCommand(`trigger "${srvId}"`);
    console.log(r.output);

    await ask('\nPress Enter to continue...');
}

async function viewLogsAction() {
    const isOnline = await probeServer();
    printHeader(isOnline, serverStatusData);

    const count = await ask('Number of log entries to display (default: 20): ') || '20';
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
    console.log('  [3] Test Current Webhook');
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

/**
 * Interactive Command REPL shell: allows user to type any CLI command directly!
 */
async function interactiveRepl() {
    const isOnline = await probeServer();
    printHeader(isOnline, serverStatusData);
    console.log('💻 Interactive Command Console');
    console.log('Type any CLI command directly (e.g. "status", "list", "server add ...", "trigger ...", "help").');
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
 * Spawns the web server if not already running
 */
async function spinUpServer() {
    const isOnline = await probeServer();
    if (isOnline) {
        console.log(`\n✅ The server is ALREADY spinning at ${SERVER_URL}!`);
        await ask('\nPress Enter to return to menu...');
        return;
    }

    console.log('\n🚀 Spinning up AttendanceBot Web Server (node server.js)...');
    const child = spawn('node', ['server.js'], {
        cwd: path.join(__dirname, '..'),
        detached: true,
        stdio: 'ignore',
    });
    child.unref();

    console.log('⏳ Waiting for server to initialize...');
    let attempts = 0;
    while (attempts < 10) {
        await new Promise((r) => setTimeout(r, 800));
        const up = await probeServer();
        if (up) {
            console.log(`\n🎉 Server is ONLINE and spinning at ${SERVER_URL}!`);
            console.log('You can access the Web Dashboard in your browser or manage via CLI here.');
            await ask('\nPress Enter to return to menu...');
            return;
        }
        attempts++;
    }

    console.log('⚠️ Server started in background. If it does not respond shortly, run "npm start" manually.');
    await ask('\nPress Enter to return to menu...');
}

async function mainMenu() {
    while (true) {
        const isOnline = await probeServer();
        printHeader(isOnline, serverStatusData);

        console.log('  [1] View All Configurations & Status');
        console.log('  [2] Add New Server Profile (Wizard)');
        console.log('  [3] Manage / Pause / Resume / Delete Server');
        console.log('  [4] Start / Stop Attendance Daemon');
        console.log('  [5] Trigger Attendance Task Now (Immediate Test)');
        console.log('  [6] View Live Activity Logs');
        console.log('  [7] Update Discord Token & Webhook');
        console.log('  [8] Interactive CLI Command Console (REPL)');
        console.log('  [S] Spin Up Web Dashboard Server');
        console.log('  [9] Exit');
        console.log('══════════════════════════════════════════════════');

        const choice = (await ask('Select an option (1-9, or S): ')).toLowerCase();

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
            await toggleDaemonAction();
        } else if (choice === '5') {
            await triggerTaskAction();
        } else if (choice === '6') {
            await viewLogsAction();
        } else if (choice === '7') {
            await updateCredentialsAction();
        } else if (choice === '8') {
            await interactiveRepl();
        } else if (choice === 's') {
            await spinUpServer();
        } else if (choice === '9' || choice === 'q') {
            console.log('\n👋 Exiting AttendanceBot CLI. Goodbye!\n');
            rl.close();
            process.exit(0);
        }
    }
}

/**
 * Main entry: Check if command-line arguments were provided (non-interactive mode)
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length > 0) {
        // Direct command execution from terminal!
        // e.g. attendanceBot status, attendanceBot list, attendanceBot start
        const res = await dispatchCommand(args);
        console.log(res.output);
        process.exit(res.success ? 0 : 1);
        return;
    }

    // Interactive Menu Mode
    await mainMenu();
}

main().catch((err) => {
    console.error(`Fatal CLI error: ${err.message}`);
    process.exit(1);
});
