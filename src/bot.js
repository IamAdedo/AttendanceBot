/**
 * src/bot.js
 *
 * AttendanceBot (L2E Engine)
 * Author & Architect: IamAdedo, dlazyHNTR
 *
 * Main daemon manager responsible for:
 * - Loading config.json database
 * - Initializing discord.js-selfbot client
 * - Registering node-cron schedules per server profile
 * - Delegating task execution to src/engine/worker.js
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { Client } = require('discord.js-selfbot-v13');
const { executeAttendanceTask, sendWebhookNotification } = require('./engine/worker');
const logger = require('./logger');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// 1. Verify Configuration File Exists
if (!fs.existsSync(CONFIG_PATH)) {
    logger.error('config.json missing! Run "npm start" to set up your servers.');
    process.exit(1);
}

let config;
try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (err) {
    logger.error(`Failed to parse config.json: ${err.message}`);
    process.exit(1);
}

if (!config.globalToken) {
    logger.error('Discord User Token missing from config.json. Run "npm start" setup.');
    process.exit(1);
}

// 2. Initialize Selfbot Client
const client = new Client({
    checkUpdate: false, // Prevents selfbot library update checks
});

const activeJobs = [];

/**
 * Parses and initializes all active server profiles and schedules.
 */
function initializeSchedules() {
    const activeServers = config.servers ? config.servers.filter((s) => s.active) : [];

    if (activeServers.length === 0) {
        logger.warn('No active server profiles found in config.json.');
        return;
    }

    logger.info(`Initializing schedules across ${activeServers.length} active server profile(s)...`);

    activeServers.forEach((server) => {
        const activeSchedules = server.schedules ? server.schedules.filter((sched) => sched.active) : [];

        activeSchedules.forEach((schedule) => {
            if (!cron.validate(schedule.cron)) {
                logger.error(`[${server.name}] Invalid cron expression syntax: "${schedule.cron}" for "${schedule.label}". Skipping.`);
                return;
            }

            logger.info(`[${server.name}] Loaded Schedule: "${schedule.label}" (${schedule.cron})`);

            // Register the cron task
            const job = cron.schedule(schedule.cron, async () => {
                // Hand off execution entirely to worker.js
                await executeAttendanceTask(client, server, schedule, config.globalWebhookUrl);
            });

            activeJobs.push(job);
        });
    });

    logger.success(`Daemon fully initialized with ${activeJobs.length} active schedule watcher(s).`);
}

// 3. Client Gateway Event Handlers
client.on('ready', () => {
    logger.success(`Daemon running as user: ${client.user.tag}`);

    // Start all cron schedulers
    initializeSchedules();

    // Send Daemon Startup Notification to Global Webhook if available
    if (config.globalWebhookUrl) {
        sendWebhookNotification(config.globalWebhookUrl, {
            title: '🟢 AttendanceBot Daemon Started',
            color: 3447003, // Blue
            description: `Background daemon successfully online for **${client.user.tag}**. Monitoring **${activeJobs.length}** active schedule timer(s).`,
            fields: [
                { name: 'Active Profiles', value: `${config.servers.filter((s) => s.active).length}`, inline: true },
                { name: 'Active Schedules', value: `${activeJobs.length}`, inline: true },
            ],
            footer: { text: 'AttendanceBot by IamAdedo, dlazyHNTR' },
        });
    }
});

// Handle Rate Limits and Warnings
client.on('rateLimit', (rateLimitInfo) => {
    logger.warn(`Rate limit hit: ${rateLimitInfo.timeout}ms delay on route ${rateLimitInfo.route}`);
});

client.on('error', (error) => {
    logger.error(`Discord Gateway Error: ${error.message}`);
});

// 4. Graceful Shutdown Signals (PM2 / OS process signals)
function handleShutdown(signal) {
    logger.warn(`Received ${signal}. Shutting down AttendanceBot daemon gracefully...`);

    // Stop all running cron jobs
    activeJobs.forEach((job) => job.stop());

    // Destroy Discord Web-socket Connection
    if (client) {
        client.destroy();
    }

    process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// 5. Authenticate Client
logger.info('Authenticating with Discord Gateway...');
client.login(config.globalToken).catch((err) => {
    logger.error(`Failed to log into Discord: ${err.message}`);
    process.exit(1);
});
