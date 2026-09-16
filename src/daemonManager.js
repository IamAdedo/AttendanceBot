const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const https = require('https');
const { Client } = require('discord.js-selfbot-v13');
const { executeAttendanceTask, sendWebhookNotification } = require('./engine/worker');
const logger = require('./logger');
const attendanceHistory = require('./attendanceHistory');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

class DaemonManager {
    constructor() {
        this.status = 'STOPPED'; // 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR'
        this.client = null;
        this.activeJobs = [];
        this.startedAt = null;
        this.errorMessage = null;
        this.user = null;
    }

    getConfig() {
        if (!fs.existsSync(CONFIG_PATH)) {
            const fallback = {
                globalToken: process.env.DISCORD_USER_TOKEN || '',
                globalWebhookUrl: process.env.GLOBAL_WEBHOOK_URL || '',
                servers: []
            };
            this.saveConfig(fallback);
            return fallback;
        }
        try {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed.servers) parsed.servers = [];
            return parsed;
        } catch (err) {
            logger.error(`Failed to read config.json: ${err.message}`);
            return {
                globalToken: '',
                globalWebhookUrl: '',
                servers: []
            };
        }
    }

    saveConfig(data) {
        try {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
            if (this.status === 'RUNNING' && this.client) {
                this.initializeSchedules(data);
            }
            return true;
        } catch (err) {
            logger.error(`Failed to save config.json: ${err.message}`);
            return false;
        }
    }

    isOneTimeDueToday(schedule) {
        if (!schedule.runDate) return true;
        const target = new Date(schedule.runDate);
        const now = new Date();
        return (
            target.getFullYear() === now.getFullYear() &&
            target.getMonth() === now.getMonth() &&
            target.getDate() === now.getDate()
        );
    }

    initializeSchedules(config) {
        this.stopSchedules();

        const activeServers = (config.servers || []).filter((s) => s.active);
        if (activeServers.length === 0) {
            logger.warn('No active server profiles found in configuration.');
            return;
        }

        logger.info(`Initializing schedules across ${activeServers.length} active server profile(s)...`);

        activeServers.forEach((server) => {
            const activeSchedules = (server.schedules || []).filter((sched) => sched.active);

            activeSchedules.forEach((schedule) => {
                if (!cron.validate(schedule.cron)) {
                    logger.error(`[${server.name}] Invalid cron expression syntax: "${schedule.cron}" for "${schedule.label}". Skipping.`);
                    return;
                }

                const isOneTime = schedule.type === 'ONCE';

                if (isOneTime && schedule.runDate) {
                    const target = new Date(schedule.runDate);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    target.setHours(0, 0, 0, 0);
                    if (target < today) {
                        logger.warn(`[${server.name}] One-time schedule "${schedule.label}" is in the past. Disabling.`);
                        schedule.active = false;
                        this.saveConfig(config);
                        return;
                    }
                }

                logger.info(`[${server.name}] Loaded Schedule: "${schedule.label}" (${schedule.cron})${isOneTime ? ' [ONE-TIME]' : ''}`);

                const job = cron.schedule(schedule.cron, async () => {
                    if (isOneTime && !this.isOneTimeDueToday(schedule)) {
                        return;
                    }

                    if (this.client) {
                        await executeAttendanceTask(this.client, server, schedule, config.globalWebhookUrl);
                    } else {
                        logger.warn(`[${server.name}] Schedule fired but Discord client is offline.`);
                    }

                    if (isOneTime) {
                        schedule.active = false;
                        this.saveConfig(config);
                        job.stop();
                        logger.success(`[${server.name}] One-time schedule "${schedule.label}" completed and disabled.`);
                    }
                });

                this.activeJobs.push({
                    serverId: server.id,
                    scheduleId: schedule.id,
                    job,
                });
            });
        });

        logger.success(`Daemon loaded ${this.activeJobs.length} active schedule watcher(s).`);
    }

    stopSchedules() {
        if (this.activeJobs.length > 0) {
            this.activeJobs.forEach((item) => {
                try { item.job.stop(); } catch (e) { /* ignore */ }
            });
            this.activeJobs = [];
        }
    }

    async start() {
        if (this.status === 'RUNNING' || this.status === 'STARTING') {
            return { success: false, message: 'Daemon is already running or starting.' };
        }

        const config = this.getConfig();
        const token = config.globalToken || process.env.DISCORD_USER_TOKEN;

        if (!token || !token.trim()) {
            this.status = 'STOPPED';
            this.errorMessage = 'Discord User Token is missing. Set your token in Credentials Settings.';
            logger.warn('Cannot start daemon: Discord User Token is missing.');
            return { success: false, message: this.errorMessage };
        }

        this.status = 'STARTING';
        this.errorMessage = null;
        logger.info('Starting AttendanceBot daemon...');

        try {
            this.client = new Client({ checkUpdate: false });

            this.client.on('ready', () => {
                this.status = 'RUNNING';
                this.startedAt = Date.now();
                this.user = {
                    tag: this.client.user?.tag || 'Unknown',
                    id: this.client.user?.id || '',
                    username: this.client.user?.username || '',
                };
                logger.success(`Discord Gateway connected! Daemon running as user: ${this.user.tag}`);

                this.initializeSchedules(config);

                if (config.globalWebhookUrl) {
                    sendWebhookNotification(config.globalWebhookUrl, {
                        title: '🟢 AttendanceBot Daemon Started',
                        color: 3447003,
                        description: `Background daemon online for **${this.user.tag}**. Monitoring **${this.activeJobs.length}** active schedule timer(s).`,
                        fields: [
                            { name: 'Active Profiles', value: `${(config.servers || []).filter((s) => s.active).length}`, inline: true },
                            { name: 'Active Schedules', value: `${this.activeJobs.length}`, inline: true },
                        ],
                    });
                }
            });

            this.client.on('rateLimit', (rateLimitInfo) => {
                logger.warn(`Discord rate limit encountered: ${rateLimitInfo.timeout}ms delay on ${rateLimitInfo.route}`);
            });

            this.client.on('error', (err) => {
                logger.error(`Discord Gateway Error: ${err.message}`);
                this.errorMessage = err.message;
            });

            logger.info('Authenticating Discord client...');
            await this.client.login(token);

            return { success: true, message: 'Daemon connection initiated.' };
        } catch (err) {
            this.status = 'ERROR';
            this.errorMessage = err.message;
            logger.error(`Failed to start daemon: ${err.message}`);
            this.stop();
            return { success: false, message: err.message };
        }
    }

    async stop() {
        logger.warn('Stopping AttendanceBot daemon...');
        this.stopSchedules();

        if (this.client) {
            try {
                this.client.destroy();
            } catch (e) {
                /* ignore */
            }
            this.client = null;
        }

        this.status = 'STOPPED';
        this.startedAt = null;
        this.user = null;
        logger.info('Daemon stopped successfully.');
        return { success: true, message: 'Daemon stopped.' };
    }

    getStatus() {
        const config = this.getConfig();
        const activeServers = (config.servers || []).filter((s) => s.active);
        const totalSchedules = (config.servers || []).reduce(
            (acc, s) => acc + (s.schedules ? s.schedules.length : 0),
            0
        );
        const activeSchedules = (config.servers || []).reduce(
            (acc, s) => acc + (s.active && s.schedules ? s.schedules.filter((sc) => sc.active).length : 0),
            0
        );

        return {
            status: this.status,
            uptime: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
            user: this.user,
            errorMessage: this.errorMessage,
            activeJobsCount: this.activeJobs.length,
            stats: {
                totalServers: (config.servers || []).length,
                activeServers: activeServers.length,
                totalSchedules,
                activeSchedules,
            },
            serverHealth: attendanceHistory.getServerHealthMap(config.servers || []),
            dailyStats: attendanceHistory.getDailyStats(30),
        };
    }

    async triggerTask(serverId, scheduleId, simulate = false) {
        const config = this.getConfig();
        const server = (config.servers || []).find((s) => String(s.id) === String(serverId));
        if (!server) {
            throw new Error(`Server profile ${serverId} not found.`);
        }

        const schedule = (server.schedules || []).find((sc) => String(sc.id) === String(scheduleId));
        if (!schedule) {
            throw new Error(`Schedule ${scheduleId} not found on server ${server.name}.`);
        }

        logger.info(`[Trigger] Manual trigger requested for "${server.name}" - "${schedule.label}" (Simulate: ${simulate || !this.client})`);

        if (simulate || !this.client) {
            // Simulated execution without live Discord client
            const isReaction = (schedule.attendanceType || 'MESSAGE').toUpperCase() === 'REACTION';
            const actionDesc = isReaction
                ? `Reaction with emoji "${schedule.emoji || '👍'}" to channel ${server.channelId}`
                : `Message "${schedule.message || 'Present'}" to channel ${server.channelId}`;

            logger.info(`[Simulation] Simulating attendance dispatch for server "${server.name}"...`);
            await new Promise((r) => setTimeout(r, 1000));
            logger.success(`[Simulation] ${actionDesc} completed successfully!`);

            attendanceHistory.recordExecution({
                serverId: server.id,
                serverName: server.name,
                channelId: server.channelId,
                scheduleId: schedule.id,
                scheduleLabel: schedule.label,
                type: isReaction ? 'REACTION' : 'MESSAGE',
                status: 'SUCCESS',
                details: `[Manual / Test Run] ${actionDesc}`
            });

            const webhookUrl = server.webhookUrl || config.globalWebhookUrl;
            if (webhookUrl) {
                sendWebhookNotification(webhookUrl, {
                    title: '✅ Attendance Dispatched (Manual / Test Run)',
                    color: 3066993,
                    fields: [
                        { name: 'Server Profile', value: server.name, inline: true },
                        { name: 'Channel ID', value: server.channelId, inline: true },
                        { name: 'Schedule', value: schedule.label, inline: true },
                        { name: isReaction ? 'Emoji' : 'Message', value: isReaction ? (schedule.emoji || '👍') : (schedule.message || 'Present'), inline: false },
                        { name: 'Mode', value: this.client ? 'Live Run' : 'Simulation Mode', inline: true },
                    ],
                });
            }

            return {
                success: true,
                simulated: true,
                message: `Attendance test completed (${isReaction ? 'Reaction' : 'Message'}).`,
            };
        }

        // Live execution with connected client
        await executeAttendanceTask(this.client, server, schedule, config.globalWebhookUrl);
        return {
            success: true,
            simulated: false,
            message: `Attendance task executed live for server ${server.name}!`,
        };
    }

    testWebhook(webhookUrl) {
        return new Promise((resolve) => {
            if (!webhookUrl || !webhookUrl.startsWith('http')) {
                return resolve({ success: false, message: 'Invalid webhook URL provided' });
            }

            try {
                const url = new URL(webhookUrl);
                const payload = JSON.stringify({
                    embeds: [
                        {
                            title: '🔔 AttendanceBot Webhook Connected',
                            description: 'Test notification from AttendanceBot Web Dashboard! Webhook alerts are functioning properly.',
                            color: 5814783,
                            footer: { text: 'AttendanceBot by IamAdedo, dlazyHNTR' },
                            timestamp: new Date().toISOString(),
                        },
                    ],
                });

                const req = https.request(
                    url,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(payload),
                        },
                    },
                    (res) => {
                        const ok = res.statusCode >= 200 && res.statusCode < 300;
                        resolve({
                            success: ok,
                            statusCode: res.statusCode,
                            message: ok ? 'Webhook notification delivered!' : `Webhook returned status HTTP ${res.statusCode}`,
                        });
                    }
                );

                req.on('error', (err) => {
                    resolve({ success: false, message: err.message });
                });

                req.write(payload);
                req.end();
            } catch (err) {
                resolve({ success: false, message: err.message });
            }
        });
    }
}

const daemonManager = new DaemonManager();
module.exports = daemonManager;
