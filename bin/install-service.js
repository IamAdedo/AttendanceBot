#!/usr/bin/env node

const pm2 = require('pm2');
const path = require('path');
const fs = require('fs');

const BOT_PATH = path.join(__dirname, '..', 'src', 'bot.js');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const SERVICE_NAME = 'attendanceBot-daemon';

if (!fs.existsSync(CONFIG_PATH)) {
    console.error('❌ Error: config.json not found!');
    console.error('👉 Run "npm start" first to configure your servers.\n');
    process.exit(1);
}

pm2.connect((err) => {
    if (err) {
        console.error('❌ Failed to connect to PM2:', err.message);
        process.exit(1);
    }

    pm2.start(
        {
            script: BOT_PATH,
            name: SERVICE_NAME,
            autorestart: true,
            max_memory_restart: '150M',
        },
        (err) => {
            if (err) {
                console.error('❌ PM2 registration failed:', err.message);
                pm2.disconnect();
                process.exit(1);
            }

            pm2.dump(() => {
                pm2.disconnect();
                console.log(`\n✅ Background Daemon "${SERVICE_NAME}" installed and running!`);
                console.log('📌 Commands:');
                console.log('  - Status : npm run service:status');
                console.log('  - Logs   : npm run service:logs');
                console.log('  - Stop   : npm run service:uninstall\n');
            });
        }
    );
});
