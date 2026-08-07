#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');
const { spawn } = require('child_process');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const ask = (query) => new Promise((resolve) => rl.question(query, (ans) => resolve(ans.trim())));

/**
 * Collects a multi-line message. The user types as many lines as they want;
 * an empty line (just pressing Enter) finishes the input. Blank input returns
 * the supplied default. Internally lines are joined with "\n" so Discord
 * renders them as a real multi-line message.
 *
 * @param {string} defaultValue - Returned when the user enters nothing.
 * @returns {Promise<string>}
 */
async function askMultiline(defaultValue = 'Present') {
    console.log('  ✏️  Enter your message. Multiple lines allowed.');
    console.log('     Press Enter on an EMPTY line to finish.');
    console.log(`     (Leave the first line blank to use default: "${defaultValue.replace(/\n/g, ' / ')}")`);

    const lines = [];
    while (true) {
        const line = await new Promise((resolve) => rl.question('  > ', (ans) => resolve(ans)));
        if (line.trim() === '') {
            // First empty line ends input. If nothing was typed, use the default.
            break;
        }
        lines.push(line);
    }

    return lines.length > 0 ? lines.join('\n') : defaultValue;
}

function printHeader() {
    console.clear();
    console.log(`
██╗     ██████╗ ███████╗
██║     ╚════██╗██╔════╝
██║      █████╔╝█████╗
██║     ██╔═══╝ ██╔══╝
███████╗███████╗███████╗
╚══════╝╚══════╝╚══════╝
  `);
    console.log('⚡ AttendanceBot by IamAdedo, dlazyHNTR');
    console.log('══════════════════════════════════════════════════\n');
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

function testWebhook(webhookUrl) {
    return new Promise((resolve) => {
        try {
            const url = new URL(webhookUrl);
            const payload = JSON.stringify({
                embeds: [
                    {
                        title: '🔔 AttendanceBot Webhook Connected',
                        description: 'Test notification! Webhook alerts are working properly.',
                        color: 5814783,
                        footer: { text: 'AttendanceBot by IamAdedo, dlazyHNTR' },
                        timestamp: new Date().toISOString(),
                    },
                ],
            });

            const req = https.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
            }, (res) => resolve(res.statusCode >= 200 && res.statusCode < 300));

            req.on('error', () => resolve(false));
            req.write(payload);
            req.end();
        } catch {
            resolve(false);
        }
    });
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

/**
 * Resolves a user-entered weekday (name, abbreviation, or number) to a day object.
 * @param {string} input
 * @returns {{num:number,name:string}|null}
 */
function parseWeekday(input) {
    const key = (input || '').trim().toLowerCase();
    if (!key) return null;
    const match = WEEKDAYS.find((d) => d.aliases.includes(key));
    return match ? { num: match.num, name: match.name } : null;
}

/**
 * Validates and parses a one-time calendar date (YYYY-MM-DD).
 * Rejects malformed values and dates already in the past.
 * @param {string} input
 * @returns {Date|null}
 */
function parseCalendarDate(input) {
    const key = (input || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;

    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d, 0, 0, 0, 0);

    // Guard against invalid rollovers (e.g., 2026-02-31 -> Mar 3)
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
        return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date < today) return null;

    return date;
}

/**
 * Validates a time string in "HH:MM" or "HH:MM AM/PM" form.
 * @param {string} input
 * @returns {boolean}
 */
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

    // One-time calendar date (e.g., Aug 10 2026)
    if (specificDate) {
        const d = new Date(specificDate);
        return `${minutes} ${hours} ${d.getDate()} ${d.getMonth() + 1} *`;
    }

    // Specific weekday recurring (e.g., every Monday)
    if (specificDay !== null) {
        return `${minutes} ${hours} * * ${specificDay}`;
    }

    // Existing frequency options
    switch (frequency) {
        case '1': return `${minutes} ${hours} * * *`;
        case '2': return `${minutes} ${hours} * * 1-5`;
        case '3': return `${minutes} ${hours} * * 0,6`;
        default: return `${minutes} ${hours} * * *`;
    }
}

/**
 * Prompts for the time/message/jitter of a single schedule entry
 * and returns a complete schedule object.
 */
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
        message,
        maxJitterMinutes: parseInt(jitter, 10) || 10,
        active: true,
        ...(specificDate ? { type: 'ONCE', runDate: specificDate.toISOString() } : {}),
    };
}

/**
 * Interactive builder for "specific day(s)" schedules.
 * Lets the user pick one or more days (repeating weekday OR one-time calendar date)
 * and assign one or more times to each day.
 *
 * @returns {Promise<Array>} Array of schedule objects
 */
async function promptSpecificDaysSchedules() {
    const schedules = [];
    let addingDays = true;

    console.log('  ──────────────────────────────────────────────');
    console.log('  [a] Repeating weekday (every Monday, every Friday...)');
    console.log('  [b] One-time date (send on a specific calendar day)');
    const dayType = (await ask('  What kind of day? (a/b) [default: a]: ') || 'a').toLowerCase();

    while (addingDays) {
        let specificDate = null;
        let dayName = null;
        let dayLabel = '';

        if (dayType === 'b') {
            // One-time calendar date
            console.log('\n  📆 Format: YYYY-MM-DD (e.g., 2026-08-10)');
            let dateInput = await ask('  Enter the date: ');
            let parsed = parseCalendarDate(dateInput);
            while (!parsed) {
                if (dateInput.trim()) {
                    console.log('  ❌ Invalid or past date. Use YYYY-MM-DD format (e.g., 2026-08-10).');
                }
                dateInput = await ask('  Enter the date: ');
                parsed = parseCalendarDate(dateInput);
            }
            specificDate = parsed;
            dayLabel = formatDateLabel(parsed);
            console.log(`  ✅ Selected date: ${dayLabel}\n`);
        } else {
            // Repeating weekday
            console.log('  ──────────────────────────────────────────────');
            WEEKDAYS.forEach((d) => console.log(`  [${d.num}] ${d.name}`));
            let dayInput = await ask('  Select a day (number or name, e.g., 1 / Monday): ');
            let parsed = parseWeekday(dayInput);
            while (!parsed) {
                if (dayInput.trim()) {
                    console.log('  ❌ Invalid day. Enter a number (0-6) or day name (e.g., Monday).');
                }
                dayInput = await ask('  Select a day (number or name, e.g., 1 / Monday): ');
                parsed = parseWeekday(dayInput);
            }
            dayName = { num: parsed.num, name: parsed.name };
            dayLabel = parsed.name;
            console.log(`  ✅ Selected day: ${dayLabel}\n`);
        }

        // Inner loop: one or more times for this day
        let addingTimes = true;
        while (addingTimes) {
            console.log(`  ⏰ --- Time slot for ${dayLabel} ---`);
            let timeInput = await ask('  Enter time (e.g., 09:00 AM or 21:30) [default: 09:00 AM]: ') || '09:00 AM';
            while (!isValidTime(timeInput)) {
                console.log('  ❌ Invalid time. Use HH:MM (24h) or HH:MM AM/PM (e.g., 09:00 AM).');
                timeInput = await ask('  Enter time: ');
            }

            const message = await askMultiline('Present');
            const jitter = await ask('  Max random delay in minutes (Anti-Detection) [default: 10]: ') || '10';

            const cron = buildCronExpression(null, timeInput, dayName ? dayName.num : null, specificDate);
            const label = specificDate
                ? `${timeInput} (${formatDateLabel(specificDate)})`
                : `${timeInput} (${dayLabel})`;

            const schedule = {
                id: Date.now().toString() + Math.floor(Math.random() * 1000),
                label,
                cron,
                message,
                maxJitterMinutes: parseInt(jitter, 10) || 10,
                active: true,
            };

            if (specificDate) {
                schedule.type = 'ONCE';
                schedule.runDate = specificDate.toISOString();
            }

            schedules.push(schedule);
            console.log(`  ✅ Added: "${label}" -> Message: "${message}"\n`);

            const moreTimes = (await ask(`  ❓ Add another time for ${dayLabel}? (y/N): `)).toLowerCase();
            addingTimes = moreTimes === 'y';
        }

        const moreDays = (await ask('\n  ❓ Schedule another day? (y/N): ')).toLowerCase();
        addingDays = moreDays === 'y';
    }

    return schedules;
}

/**
 * Schedule builder entry point. Returns an array of schedule objects
 * (one for the simple frequencies, one or more for specific days).
 */
async function promptSchedules() {
    console.log('\n  📅 --- Schedule Builder ---');
    console.log('  [1] Everyday');
    console.log('  [2] Weekdays (Mon - Fri)');
    console.log('  [3] Weekends (Sat - Sun)');
    console.log('  [4] Specific day(s) (pick a day or date)');

    const freq = await ask('  Select frequency (1-4) [default: 1]: ') || '1';

    if (freq === '4') {
        return await promptSpecificDaysSchedules();
    }

    return [await promptScheduleEntry(freq)];
}

async function configureGlobalWebhook(db) {
    console.log('\n🔔 --- Notification Setup ---');
    console.log('Provide a Discord Webhook URL to get alerts on your phone whenever attendance posts.');
    const url = await ask('Enter Global Webhook URL (Press Enter to skip): ');

    if (url) {
        console.log('📡 Testing Webhook connection...');
        const ok = await testWebhook(url);
        if (ok) {
            db.globalWebhookUrl = url;
            saveConfig(db);
            console.log('✅ Webhook verified and saved!');
        } else {
            console.log('❌ Webhook test failed. Skipping webhook assignment.');
        }
    }
}

async function addServerWizard(db) {
    printHeader();
    console.log('➕ Add New Server Configuration\n');

    if (!db.globalToken) {
        db.globalToken = await ask('1. Enter your Discord User Token: ');
    } else {
        console.log(`🔑 Using saved Discord Token (${db.globalToken.substring(0, 10)}...)`);
        const change = await ask('   Do you want to change this token? (y/N): ');
        if (change.toLowerCase() === 'y') {
            db.globalToken = await ask('   Enter new Discord User Token: ');
        }
    }

    if (!db.globalWebhookUrl) {
        await configureGlobalWebhook(db);
    }

    const name = await ask('\n2. Profile Name for this server (e.g. Work-DAO): ');
    const channelId = await ask('3. Target Channel ID: ');
    const customWebhook = await ask('4. Custom Webhook URL for this specific server? (Press Enter for global default): ');

    const schedules = [];
    let addingSchedules = true;

    while (addingSchedules) {
        const newScheds = await promptSchedules();
        schedules.push(...newScheds);
        console.log(`\n✅ ${newScheds.length} schedule(s) added.`);

        const again = await ask('\n❓ Do you want to add another schedule for THIS server? (y/N): ');
        if (again.toLowerCase() !== 'y') {
            addingSchedules = false;
        }
    }

    db.servers.push({
        id: Date.now().toString(),
        name,
        channelId,
        webhookUrl: customWebhook || '',
        active: true,
        schedules
    });

    saveConfig(db);
    console.log(`\n🎉 Server Profile "${name}" created successfully with ${schedules.length} schedule(s)!`);
    await ask('\nPress Enter to return to main menu...');
}

async function listConfigurations(db) {
    printHeader();
    console.log('📋 Active Server Configurations\n');

    console.log(`🔑 Discord User Token  : ${db.globalToken ? 'SET' : 'NOT SET'}`);
    console.log(`🔔 Global Webhook URL  : ${db.globalWebhookUrl ? db.globalWebhookUrl.substring(0, 45) + '...' : 'NOT CONFIGURED'}\n`);

    if (db.servers.length === 0) {
        console.log('No servers configured yet. Select [1] from main menu to add one.');
    } else {
        db.servers.forEach((server, index) => {
            const status = server.active ? '🟢 ACTIVE' : '🔴 PAUSED';
            console.log(`[${index + 1}] ${server.name} (${status})`);
            console.log(`    Channel ID  : ${server.channelId}`);
            console.log(`    Webhook URL : ${server.webhookUrl ? server.webhookUrl.substring(0, 35) + '...' : 'Using Global'}`);
            console.log(`    Schedules (${server.schedules.length}):`);
            server.schedules.forEach((s) => {
                const sStatus = s.active ? 'ACTIVE' : 'DISABLED';
                const previewMsg = (s.message || '').replace(/\n/g, ' ⏎ ');
                console.log(`      - [${sStatus}] ${s.label} | Message: "${previewMsg}" | Max Jitter: ${s.maxJitterMinutes}m`);
            });
            console.log('--------------------------------------------------');
        });
    }
}

async function manageServerMenu(db) {
    printHeader();
    if (db.servers.length === 0) {
        console.log('No servers available to manage.');
        await ask('\nPress Enter to return to main menu...');
        return;
    }

    await listConfigurations(db);
    const choice = await ask('\nEnter the number of the server to manage (or press Enter to cancel): ');
    const idx = parseInt(choice, 10) - 1;

    if (isNaN(idx) || !db.servers[idx]) return;

    const server = db.servers[idx];
    console.log(`\nManaging "${server.name}":`);
    console.log('  [1] Toggle Pause/Resume Server');
    console.log('  [2] Add New Schedule to this Server');
    console.log('  [3] Set/Update Webhook URL for this Server');
    console.log('  [4] Delete Server Profile');

    const action = await ask('Select action (1-4): ');

    if (action === '1') {
        server.active = !server.active;
        saveConfig(db);
        console.log(`✅ Server "${server.name}" is now ${server.active ? 'ACTIVE' : 'PAUSED'}.`);
    } else if (action === '2') {
        const newScheds = await promptSchedules();
        server.schedules.push(...newScheds);
        saveConfig(db);
        console.log(`✅ ${newScheds.length} new schedule(s) added to "${server.name}".`);
    } else if (action === '3') {
        const url = await ask('Enter new Webhook URL for this server (Press Enter to clear/use global): ');
        server.webhookUrl = url;
        saveConfig(db);
        console.log(`✅ Webhook updated for "${server.name}".`);
    } else if (action === '4') {
        const confirm = await ask(`⚠️ Are you sure you want to DELETE "${server.name}"? (y/N): `);
        if (confirm.toLowerCase() === 'y') {
            db.servers.splice(idx, 1);
            saveConfig(db);
            console.log(`🗑️ Server "${server.name}" deleted.`);
        }
    }
    await ask('\nPress Enter to return to main menu...');
}

/**
 * Offers to install and start the background daemon service via PM2.
 * Spawns `npm run service:install` when the user accepts.
 */
async function offerServiceInstall() {
    console.log('\n🚀 --- Start Background Daemon ---');
    console.log('Your attendance schedules are configured. To keep them running');
    console.log('automatically in the background (even after terminal closes),');
    console.log('install the daemon service now.');

    const answer = await ask('\nInstall and start the background daemon? (Y/n): ');
    if (answer.toLowerCase() === 'n') {
        console.log('⏭️ Skipped. Run "npm run service:install" manually when ready.');
        return;
    }

    console.log('\n📦 Installing daemon service...');
    const child = spawn('npm', ['run', 'service:install'], {
        stdio: 'inherit',
        shell: true,
        cwd: path.join(__dirname, '..'),
    });

    await new Promise((resolve) => {
        child.on('close', (code) => {
            if (code === 0) {
                console.log('\n✅ Daemon installed and started successfully!');
            } else {
                console.log(`\n⚠️ Installation exited with code ${code}. Check logs above.`);
            }
            resolve();
        });
    });
}

async function mainMenu() {
    const db = loadConfig();

    while (true) {
        printHeader();
        console.log('  [1] Add New Server Profile');
        console.log('  [2] View All Configurations');
        console.log('  [3] Manage / Pause / Delete Server');
        console.log('  [4] Update Global Webhook URL');
        console.log('  [5] Exit');
        console.log('══════════════════════════════════════════════════');

        const choice = await ask('Select an option (1-5): ');

        if (choice === '1') {
            await addServerWizard(db);
        } else if (choice === '2') {
            await listConfigurations(db);
            await ask('\nPress Enter to return to main menu...');
        } else if (choice === '3') {
            await manageServerMenu(db);
        } else if (choice === '4') {
            await configureGlobalWebhook(db);
            await ask('\nPress Enter to return to main menu...');
        } else if (choice === '5') {
            // Offer to launch the background daemon before quitting, but only
            // when there's something worth running.
            const hasActiveSchedules = (db.servers || []).some(
                (s) => s.active && (s.schedules || []).some((sc) => sc.active)
            );
            if (hasActiveSchedules) {
                await offerServiceInstall();
            }

            console.log('\n👋 Exiting AttendanceBot CLI. Settings saved.');
            rl.close();
            process.exit(0);
        }
    }
}

mainMenu();
