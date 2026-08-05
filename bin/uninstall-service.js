#!/usr/bin/env node

const pm2 = require('pm2');
const SERVICE_NAME = 'attendanceBot-daemon';

console.log('\n==================================================');
console.log('   🗑️  AttendanceBot - Uninstalling Daemon ');
console.log('==================================================\n');

pm2.connect((err) => {
    if (err) {
        console.error('❌ Failed to connect to PM2 daemon:', err.message);
        process.exit(1);
    }

    pm2.delete(SERVICE_NAME, (err) => {
        if (err) {
            console.warn(`⚠️ Service "${SERVICE_NAME}" was not currently running or active.`);
        } else {
            console.log(`✅ Successfully removed "${SERVICE_NAME}" from PM2 background runtime.`);
        }

        pm2.dump(() => {
            pm2.disconnect();
            console.log('✅ Configuration state cleared.');
            console.log('==================================================\n');
        });
    });
});
