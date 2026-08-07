#!/usr/bin/env node

const pm2 = require('pm2');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const SERVICE_NAME = 'attendanceBot-daemon';

function isTermux() {
    return (
        process.platform === 'android' ||
        (process.env.PREFIX || '').includes('com.termux') ||
        Boolean(process.env.TERMUX_VERSION)
    );
}

/**
 * Reverses the Termux-specific setup performed by install-service.js:
 * removes the Termux:Boot autostart script and releases the wake lock.
 */
function teardownTermux() {
    const bootScript = path.join(os.homedir(), '.termux', 'boot', 'start-attendancebot.sh');
    try {
        if (fs.existsSync(bootScript)) {
            fs.unlinkSync(bootScript);
            console.log('🧹 Removed Termux:Boot autostart script.');
        }
    } catch (err) {
        console.log(`⚠️  Could not remove boot script: ${err.message}`);
    }

    execFile('termux-wake-unlock', (err) => {
        if (!err) {
            console.log('🔓 Termux wake lock released.');
        }
    });
}

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

            if (isTermux()) {
                teardownTermux();
            }

            console.log('✅ Configuration state cleared.');
            console.log('==================================================\n');
        });
    });
});
