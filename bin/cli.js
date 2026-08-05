#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const ask = (query) => new Promise((resolve) => rl.question(query, (ans) => resolve(ans.trim())));

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

function buildCronExpression(frequency, timeStr) {
    const [time, modifier] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);

    if (modifier && modifier.toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (modifier && modifier.toUpperCase() === 'AM' && hours === 12) hours = 0;

    switch (frequency) {
        case '1': return `${minutes} ${hours} * * *`;
        case '2': return `${minutes} ${hours} * * 1-5`;
        case '3': return `${minutes} ${hours} * * 0,6`;
        default: return `${minutes} ${hours} * * *`;
    }
}

async function promptSchedule() {
    console.log('\n  📅 --- Schedule Builder ---');
    console.log('  [1] Everyday');
    console.log('  [2] Weekdays (Mon - Fri)');
    console.log('  [3] Weekends (Sat - Sun)');

    const freq = await ask('  Select frequency (1-3) [default: 1]: ') || '1';
    const timeInput = await ask('  Enter time (e.g., 09:00 AM or 21:30) [default: 09:00 AM]: ') || '09:00 AM';
    const message = await ask('  Enter message to send [default: Present]: ') || 'Present';
    const jitter = await ask('  Max random delay in minutes (Anti-Detection) [default: 10]: ') || '10';

    const cron = buildCronExpression(freq, timeInput);

    return {
        id: Date.now().toString(),
        label: `${timeInput} (${freq === '1' ? 'Everyday' : freq === '2' ? 'Weekdays' : 'Weekends'})`,
        cron,
        message,
        maxJitterMinutes: parseInt(jitter, 10) || 10,
        active: true
    };
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
        const sched = await promptSchedule();
        schedules.push(sched);
        console.log(`\n✅ Schedule added: "${sched.label}" -> Message: "${sched.message}"`);

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
                console.log(`      - [${sStatus}] ${s.label} | Message: "${s.message}" | Max Jitter: ${s.maxJitterMinutes}m`);
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
        const newSched = await promptSchedule();
        server.schedules.push(newSched);
        saveConfig(db);
        console.log(`✅ New schedule added to "${server.name}".`);
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
            console.log('\n👋 Exiting AttendanceBot CLI. Settings saved.');
            rl.close();
            process.exit(0);
        }
    }
}

mainMenu();
