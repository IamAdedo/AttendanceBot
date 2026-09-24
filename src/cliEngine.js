/**
 * src/cliEngine.js
 *
 * Unified CLI command parser and executor for AttendanceBot.
 * Used by:
 * - bin/cli.js (terminal CLI / scripts / interactive menu)
 * - server.js (Web dashboard interactive CLI terminal via POST /api/cli/exec)
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const https = require('https');
const { exec } = require('child_process');

const defaultDaemonManager = require('./daemonManager');
const defaultLogger = require('./logger');
const defaultAttendanceHistory = require('./attendanceHistory');
const { validateConfigSchema } = require('./schemaValidator');
const { VERSION, DISPLAY_VERSION } = require('./version');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

/**
 * Split command line preserving quoted strings
 * e.g. server add "My Server" 123456789 "0 9 * * *" "Present today"
 */
function parseArgs(commandStr) {
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    const args = [];
    let match;
    while ((match = regex.exec(commandStr)) !== null) {
        if (match[1] !== undefined) {
            args.push(match[1]);
        } else if (match[2] !== undefined) {
            args.push(match[2]);
        } else {
            args.push(match[0]);
        }
    }
    return args;
}

function formatDuration(ms) {
    if (!ms || isNaN(ms)) return '0s';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
}

class CliEngine {
    constructor(deps = {}) {
        this.daemonManager = deps.daemonManager || defaultDaemonManager;
        this.logger = deps.logger || defaultLogger;
        this.attendanceHistory = deps.attendanceHistory || defaultAttendanceHistory;
    }

    getConfig() {
        if (this.daemonManager) {
            return this.daemonManager.getConfig();
        }
        if (!fs.existsSync(CONFIG_PATH)) {
            return { globalToken: '', globalWebhookUrl: '', servers: [] };
        }
        try {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        } catch (e) {
            return { globalToken: '', globalWebhookUrl: '', servers: [] };
        }
    }

    saveConfig(config) {
        if (this.daemonManager) {
            return this.daemonManager.saveConfig(config);
        }
        try {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
            return true;
        } catch (e) {
            return false;
        }
    }

    async execute(commandLineOrArgs) {
        let args = [];
        let commandLine = '';

        if (Array.isArray(commandLineOrArgs)) {
            args = commandLineOrArgs;
            commandLine = args.map(a => (String(a).includes(' ') ? `"${a}"` : a)).join(' ');
        } else {
            commandLine = (commandLineOrArgs || '').trim();
            if (!commandLine) {
                return { success: true, output: '' };
            }
            args = parseArgs(commandLine);
        }

        if (args.length === 0) {
            return { success: true, output: '' };
        }

        const command = (args[0] || '').toLowerCase();
        const subCommand = (args[1] || '').toLowerCase();

        try {
            switch (command) {
                case 'help':
                case '?':
                case '--help':
                case '-h':
                    return this.cmdHelp(subCommand);

                case 'status':
                case 'info':
                    return this.cmdStatus();

                case 'start':
                    return await this.cmdStart();

                case 'stop':
                    return await this.cmdStop();

                case 'restart':
                    return await this.cmdRestart();

                case 'list':
                case 'servers':
                    return this.cmdList(args.slice(1));

                case 'server':
                    return await this.cmdServer(args.slice(1));

                case 'schedule':
                case 'sched':
                    return await this.cmdSchedule(args.slice(1));

                case 'trigger':
                case 'run':
                    return await this.cmdTrigger(args.slice(1));

                case 'logs':
                case 'log':
                    return this.cmdLogs(args.slice(1));

                case 'token':
                    return this.cmdToken(args.slice(1));

                case 'webhook':
                    return await this.cmdWebhook(args.slice(1));

                case 'backup':
                case 'export':
                    return this.cmdBackup();

                case 'import':
                    return await this.cmdImport(args.slice(1));

                case 'validate':
                    return await this.cmdValidate(args.slice(1));

                case 'service':
                case 'pm2':
                    return await this.cmdService(args.slice(1));

                case 'uptime':
                    return this.cmdUptime();

                case 'clear':
                case 'cls':
                    return { success: true, output: '__CLEAR__', isClear: true };

                default:
                    return {
                        success: false,
                        output: `❌ Unknown command: "${command}". Type "help" for a list of available CLI commands.`
                    };
            }
        } catch (err) {
            return {
                success: false,
                output: `❌ Error executing command "${command}": ${err.message}`
            };
        }
    }

    cmdHelp(topic) {
        if (topic === 'server') {
            return {
                success: true,
                output: [
                    '📌 Server Profile Commands:',
                    '  server list                            List all server profiles',
                    '  server add <name> <channelId> [cron] [msg] Quick-add server profile',
                    '  server edit <id> [name] [chan] [hook]  Edit server profile details',
                    '  server toggle <id|name>                Toggle pause / resume for server',
                    '  server pause <id|name>                 Pause automated monitoring for server',
                    '  server resume <id|name>                Resume automated monitoring for server',
                    '  server delete <id|name>                Delete a server profile',
                    '  server enable-all                      Enable monitoring on all servers',
                    '  server disable-all                     Disable monitoring on all servers',
                ].join('\n')
            };
        }

        if (topic === 'schedule') {
            return {
                success: true,
                output: [
                    '📌 Schedule Commands:',
                    '  schedule list <serverId|name>          List schedules for a server',
                    '  schedule add <serverId> <cron> [msg]   Add schedule (e.g. "0 9 * * 1-5")',
                    '  schedule toggle <serverId> <schedId>   Toggle active / paused on schedule',
                    '  schedule pause <serverId> <schedId>    Pause a specific schedule',
                    '  schedule resume <serverId> <schedId>   Resume a specific schedule',
                    '  schedule delete <serverId> <schedId>   Delete a schedule from a server',
                    '  schedule reorder <serverId> <id1,id2>  Reorder schedules by priority',
                    '  schedule move <serverId> <from> <to>   Move schedule between positions',
                ].join('\n')
            };
        }

        const lines = [
            '═══════════════════════════════════════════════════════════════',
            `⚡ AttendanceBot CLI Commands & Operations (${DISPLAY_VERSION})`,
            '═══════════════════════════════════════════════════════════════',
            '  status                                 Show daemon status & health overview',
            '  start                                  Start background Discord attendance daemon',
            '  stop                                   Stop background Discord attendance daemon',
            '  restart                                Restart daemon and re-initialize schedules',
            '  list (or servers)                      List configured servers and schedules',
            '',
            '  server add <name> <chanId> [cron] [msg] Create a new server profile',
            '  server edit <id> [name] [chan] [hook]  Edit server name, channel, or webhook',
            '  server toggle <id|name>                Pause / Resume a server profile',
            '  server delete <id|name>                Remove a server profile',
            '  server enable-all / disable-all        Bulk enable or disable all servers',
            '',
            '  schedule add <srvId> <cron> [message]  Add attendance schedule to server',
            '  schedule list <srvId>                  List all schedules for a server',
            '  schedule toggle <srvId> <schedId>      Pause / Resume a specific schedule',
            '  schedule delete <srvId> <schedId>      Remove schedule from server',
            '  schedule reorder <srvId> <id1,id2>     Reorder schedule priority sequence',
            '',
            '  trigger <serverId> [scheduleId]        Manually trigger attendance run now',
            '  logs [count]                           Display recent activity logs (default: 15)',
            '  logs clear                             Clear session activity logs',
            '  token [new_token]                      View or update Discord user token',
            '  webhook [url]                          View or update Discord notification webhook',
            '  webhook test [url]                     Test webhook delivery with embed alert',
            '',
            '  backup (or export)                     Export current configuration JSON',
            '  validate <path/to/file.json>           Validate JSON schema structure',
            '  import <path/to/file.json> [merge]     Import JSON with strict schema check',
            '  service <status|install|stop|logs>     Manage background PM2 service',
            '  uptime                                 View uptime and execution reliability',
            '  clear                                  Clear terminal screen',
            '═══════════════════════════════════════════════════════════════',
            '💡 Tip: Type "help server" or "help schedule" for detailed subcommands.'
        ];

        return { success: true, output: lines.join('\n') };
    }

    cmdStatus() {
        const config = this.getConfig();
        const servers = config.servers || [];
        const activeServers = servers.filter(s => s.active);
        let totalSchedules = 0;
        let activeSchedules = 0;
        servers.forEach(s => {
            (s.schedules || []).forEach(sc => {
                totalSchedules++;
                if (s.active && sc.active) activeSchedules++;
            });
        });

        let daemonStatus = 'STOPPED';
        let userTag = 'None';
        let uptimeStr = '0s';
        let activeJobsCount = activeSchedules;

        if (this.daemonManager) {
            const st = this.daemonManager.getStatus();
            daemonStatus = st.status || 'STOPPED';
            userTag = st.user?.tag || (st.user?.username ? `@${st.user.username}` : 'Not Connected');
            activeJobsCount = st.activeJobsCount !== undefined ? st.activeJobsCount : activeSchedules;
            if (st.startedAt) {
                uptimeStr = formatDuration(Date.now() - st.startedAt);
            }
        }

        const statusEmoji = daemonStatus === 'RUNNING' ? '🟢 RUNNING' : daemonStatus === 'STARTING' ? '🟡 STARTING' : daemonStatus === 'ERROR' ? '🔴 ERROR' : '⚪ STOPPED';

        const lines = [
            '─────────────────────────────────────────────────────────────',
            '📊 AttendanceBot System & Daemon Status',
            '─────────────────────────────────────────────────────────────',
            `  Daemon State     : ${statusEmoji}`,
            `  Discord Account  : ${userTag}`,
            `  Daemon Uptime    : ${uptimeStr}`,
            `  Web Server Port  : 3271 (Dashboard: http://localhost:3271)`,
            `  Discord Token    : ${config.globalToken ? `Configured (${config.globalToken.substring(0, 8)}...)` : '❌ MISSING (run "token <value>")'}`,
            `  Global Webhook   : ${config.globalWebhookUrl ? config.globalWebhookUrl.substring(0, 45) + '...' : 'Not Configured'}`,
            `  Server Profiles  : ${servers.length} configured (${activeServers.length} active)`,
            `  Schedules Count  : ${totalSchedules} total (${activeSchedules} active timers)`,
            `  Cron Watchers    : ${activeJobsCount} live cron triggers registered`,
            '─────────────────────────────────────────────────────────────',
        ];

        return { success: true, output: lines.join('\n') };
    }

    async cmdStart() {
        if (!this.daemonManager) {
            return { success: false, output: '❌ Daemon Manager instance is not attached in standalone CLI mode.' };
        }
        const res = await this.daemonManager.start();
        if (res.success) {
            return {
                success: true,
                output: '✅ AttendanceBot daemon started successfully!\nSchedules are now actively monitored.'
            };
        } else {
            return {
                success: false,
                output: `❌ Failed to start daemon: ${res.message || 'Unknown error'}`
            };
        }
    }

    async cmdStop() {
        if (!this.daemonManager) {
            return { success: false, output: '❌ Daemon Manager instance is not attached in standalone CLI mode.' };
        }
        const res = await this.daemonManager.stop();
        if (res.success) {
            return {
                success: true,
                output: '⚪ AttendanceBot daemon stopped. Schedule timers paused.'
            };
        } else {
            return {
                success: false,
                output: `❌ Failed to stop daemon: ${res.message || 'Unknown error'}`
            };
        }
    }

    async cmdRestart() {
        if (!this.daemonManager) {
            return { success: false, output: '❌ Daemon Manager instance is not attached in standalone CLI mode.' };
        }
        await this.daemonManager.stop();
        const res = await this.daemonManager.start();
        if (res.success) {
            return { success: true, output: '🔄 AttendanceBot daemon restarted successfully!' };
        } else {
            return { success: false, output: `❌ Failed to restart daemon: ${res.message}` };
        }
    }

    cmdList(args = []) {
        const config = this.getConfig();
        const servers = config.servers || [];

        if (servers.length === 0) {
            return {
                success: true,
                output: '⚠️ No Discord server profiles configured yet.\nUse: server add <name> <channelId> [cron] [message] to create your first profile.'
            };
        }

        const healthMap = (this.attendanceHistory && this.attendanceHistory.getServerHealthMap)
            ? this.attendanceHistory.getServerHealthMap(servers)
            : {};

        const lines = [
            `📋 Configured Server Profiles (${servers.length} Total):`,
            '─────────────────────────────────────────────────────────────',
        ];

        servers.forEach((srv, idx) => {
            const hInfo = healthMap[srv.id] || {};
            const health = !srv.active ? '⚪ DISABLED' : (hInfo.health === 'FAILED' ? '🔴 FAILED' : '🟢 RUNNING');
            const scheds = srv.schedules || [];

            lines.push(`[#${idx + 1}] ID: ${srv.id} | Name: "${srv.name}" | Status: ${health}`);
            lines.push(`     Channel ID : ${srv.channelId}`);
            if (srv.webhookUrl) lines.push(`     Webhook    : ${srv.webhookUrl.substring(0, 45)}...`);
            if (hInfo.lastSuccessfulAt) {
                const diffMs = Math.max(0, Date.now() - new Date(hInfo.lastSuccessfulAt).getTime());
                const mins = Math.floor(diffMs / 60000);
                const timeAgo = mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
                lines.push(`     Uptime     : Last success ${timeAgo}`);
            }

            if (scheds.length === 0) {
                lines.push('     Schedules  : None configured');
            } else {
                lines.push(`     Schedules (${scheds.length}):`);
                scheds.forEach((sc, sIdx) => {
                    const scState = sc.active ? 'ACTIVE' : 'PAUSED';
                    const msgPreview = (sc.message || 'Present').replace(/\n/g, ' ⏎ ');
                    lines.push(`       ${sIdx + 1}. [${scState}] ID:${sc.id} | "${sc.label}" (${sc.cron}) | Jitter:${sc.maxJitterMinutes || 0}m | "${msgPreview}"`);
                });
            }
            lines.push('─────────────────────────────────────────────────────────────');
        });

        return { success: true, output: lines.join('\n') };
    }

    async cmdServer(args) {
        const sub = (args[0] || '').toLowerCase();
        const config = this.getConfig();
        const servers = config.servers || [];

        if (!sub || sub === 'list') {
            return this.cmdList(args.slice(1));
        }

        if (sub === 'add') {
            const name = args[1];
            const channelId = args[2];
            const cronExp = args[3] || '0 9 * * 1-5';
            const message = args[4] || 'Present';

            if (!name || !channelId) {
                return {
                    success: false,
                    output: '❌ Usage: server add "<server_name>" <channel_id> [cron_expression] [message]'
                };
            }

            const cleanChan = channelId.trim();
            const cleanName = name.trim().toLowerCase();
            const existingServer = servers.find(
                (s) => (s.channelId && s.channelId.trim() === cleanChan) ||
                       (s.name && s.name.trim().toLowerCase() === cleanName)
            );

            if (existingServer) {
                return {
                    success: false,
                    output: `⚠️ Server profile "${existingServer.name}" already exists (Channel: ${existingServer.channelId}, ID: ${existingServer.id}).\nTo add a schedule to this server, run:\n  schedule add ${existingServer.id} "${cronExp}" "${message}"`
                };
            }

            if (cronExp && !cron.validate(cronExp)) {
                return {
                    success: false,
                    output: `❌ Invalid cron expression syntax: "${cronExp}". Example: "0 9 * * 1-5" for weekdays 9:00 AM.`
                };
            }

            const newServer = {
                id: Date.now().toString(),
                name: name.trim(),
                channelId: channelId.trim(),
                webhookUrl: '',
                active: true,
                schedules: [
                    {
                        id: Date.now().toString() + '01',
                        label: 'Default Attendance',
                        cron: cronExp.trim(),
                        attendanceType: 'MESSAGE',
                        message: message.trim(),
                        emoji: '👍',
                        targetMessageId: '',
                        maxJitterMinutes: 10,
                        active: true,
                    }
                ]
            };

            servers.push(newServer);
            config.servers = servers;
            const saved = this.saveConfig(config);

            if (saved) {
                return {
                    success: true,
                    output: `✅ Server profile "${newServer.name}" created successfully with 1 schedule.\nServer ID: ${newServer.id} | Channel ID: ${newServer.channelId}`
                };
            } else {
                return { success: false, output: '❌ Failed to save configuration to disk.' };
            }
        }

        if (sub === 'pause' || sub === 'resume') {
            const target = args[1];
            if (!target) return { success: false, output: `❌ Usage: server ${sub} <serverId|serverName>` };

            const srv = servers.find(s => String(s.id) === target || s.name.toLowerCase() === target.toLowerCase());
            if (!srv) {
                return { success: false, output: `❌ Server "${target}" not found.` };
            }

            srv.active = (sub === 'resume');
            config.servers = servers;
            this.saveConfig(config);
            return {
                success: true,
                output: `✅ Server "${srv.name}" (ID: ${srv.id}) is now ${srv.active ? 'ACTIVE (Resumed)' : 'PAUSED (Disabled)'}.`
            };
        }

        if (sub === 'delete' || sub === 'rm') {
            const target = args[1];
            if (!target) return { success: false, output: '❌ Usage: server delete <serverId|serverName>' };

            const idx = servers.findIndex(s => String(s.id) === target || s.name.toLowerCase() === target.toLowerCase());
            if (idx === -1) {
                return { success: false, output: `❌ Server "${target}" not found.` };
            }

            const removed = servers.splice(idx, 1)[0];
            config.servers = servers;
            this.saveConfig(config);
            return {
                success: true,
                output: `🗑️ Server "${removed.name}" (ID: ${removed.id}) has been deleted.`
            };
        }

        if (sub === 'toggle') {
            const target = args[1];
            if (!target) return { success: false, output: '❌ Usage: server toggle <serverId|serverName>' };
            const srv = servers.find(s => String(s.id) === target || s.name.toLowerCase() === target.toLowerCase());
            if (!srv) return { success: false, output: `❌ Server "${target}" not found.` };
            srv.active = !srv.active;
            config.servers = servers;
            this.saveConfig(config);
            return {
                success: true,
                output: `✅ Server "${srv.name}" (ID: ${srv.id}) is now ${srv.active ? 'ACTIVE' : 'PAUSED'}.`
            };
        }

        if (sub === 'edit') {
            const target = args[1];
            const newName = args[2];
            const newChan = args[3];
            const newWebhook = args[4];
            if (!target) return { success: false, output: '❌ Usage: server edit <serverId|serverName> [newName] [newChannelId] [newWebhookUrl]' };
            const srv = servers.find(s => String(s.id) === target || s.name.toLowerCase() === target.toLowerCase());
            if (!srv) return { success: false, output: `❌ Server "${target}" not found.` };
            if (newName && newName !== '-') srv.name = newName.trim();
            if (newChan && newChan !== '-') srv.channelId = newChan.trim();
            if (newWebhook !== undefined && newWebhook !== '-') srv.webhookUrl = newWebhook.trim();
            config.servers = servers;
            this.saveConfig(config);
            return {
                success: true,
                output: `✅ Server "${srv.name}" (ID: ${srv.id}) updated.\nChannel: ${srv.channelId} | Webhook: ${srv.webhookUrl || 'None'}`
            };
        }

        if (sub === 'enable-all' || sub === 'disable-all') {
            const enable = (sub === 'enable-all');
            servers.forEach(s => { s.active = enable; });
            config.servers = servers;
            this.saveConfig(config);
            return {
                success: true,
                output: `✅ ${enable ? 'Enabled' : 'Disabled'} all ${servers.length} server profiles.`
            };
        }

        return {
            success: false,
            output: `❌ Unknown server subcommand: "${sub}". Try "help server".`
        };
    }

    async cmdSchedule(args) {
        const sub = (args[0] || '').toLowerCase();
        const config = this.getConfig();
        const servers = config.servers || [];

        if (sub === 'list') {
            const target = args[1];
            if (!target) return { success: false, output: '❌ Usage: schedule list <serverId|serverName>' };
            const srv = servers.find(s => String(s.id) === target || s.name.toLowerCase() === target.toLowerCase());
            if (!srv) return { success: false, output: `❌ Server "${target}" not found.` };

            const scheds = srv.schedules || [];
            if (scheds.length === 0) return { success: true, output: `Server "${srv.name}" has no schedules.` };

            const lines = [`📅 Schedules for "${srv.name}" (ID: ${srv.id}):`];
            scheds.forEach((sc, i) => {
                lines.push(`  [#${i + 1}] ID: ${sc.id} | "${sc.label}" | Cron: "${sc.cron}" | Active: ${sc.active ? 'YES' : 'NO'}`);
            });
            return { success: true, output: lines.join('\n') };
        }

        if (sub === 'add') {
            const target = args[1];
            const cronExp = args[2];
            const message = args[3] || 'Present';
            const label = args[4] || 'Scheduled Attendance';

            if (!target || !cronExp) {
                return { success: false, output: '❌ Usage: schedule add <serverId|serverName> <cron> [message] [label]' };
            }

            if (!cron.validate(cronExp)) {
                return { success: false, output: `❌ Invalid cron expression syntax: "${cronExp}".` };
            }

            const srv = servers.find(s => String(s.id) === target || s.name.toLowerCase() === target.toLowerCase());
            if (!srv) return { success: false, output: `❌ Server "${target}" not found.` };

            if (!srv.schedules) srv.schedules = [];
            const newSched = {
                id: Date.now().toString() + Math.floor(Math.random() * 100),
                label,
                cron: cronExp.trim(),
                attendanceType: 'MESSAGE',
                message,
                emoji: '👍',
                targetMessageId: '',
                maxJitterMinutes: 10,
                active: true,
            };

            srv.schedules.push(newSched);
            config.servers = servers;
            this.saveConfig(config);
            return {
                success: true,
                output: `✅ Added schedule "${newSched.label}" to server "${srv.name}".\nSchedule ID: ${newSched.id} | Cron: ${newSched.cron}`
            };
        }

        if (sub === 'delete' || sub === 'rm') {
            const target = args[1];
            const schedId = args[2];
            if (!target || !schedId) {
                return { success: false, output: '❌ Usage: schedule delete <serverId> <scheduleId>' };
            }
            const srv = servers.find(s => String(s.id) === target || s.name.toLowerCase() === target.toLowerCase());
            if (!srv) return { success: false, output: `❌ Server "${target}" not found.` };

            const idx = (srv.schedules || []).findIndex(sc => String(sc.id) === String(schedId));
            if (idx === -1) return { success: false, output: `❌ Schedule "${schedId}" not found on server "${srv.name}".` };

            const removed = srv.schedules.splice(idx, 1)[0];
            config.servers = servers;
            this.saveConfig(config);
            return {
                success: true,
                output: `🗑️ Schedule "${removed.label}" deleted from server "${srv.name}".`
            };
        }

        if (sub === 'toggle' || sub === 'pause' || sub === 'resume') {
            const target = args[1];
            const schedId = args[2];
            if (!target || !schedId) return { success: false, output: `❌ Usage: schedule ${sub} <serverId> <scheduleId>` };
            const srv = servers.find(s => String(s.id) === target || s.name.toLowerCase() === target.toLowerCase());
            if (!srv) return { success: false, output: `❌ Server "${target}" not found.` };
            const sc = (srv.schedules || []).find(s => String(s.id) === String(schedId));
            if (!sc) return { success: false, output: `❌ Schedule "${schedId}" not found on server "${srv.name}".` };
            if (sub === 'toggle') sc.active = !sc.active;
            else if (sub === 'pause') sc.active = false;
            else if (sub === 'resume') sc.active = true;
            config.servers = servers;
            this.saveConfig(config);
            return {
                success: true,
                output: `✅ Schedule "${sc.label}" on server "${srv.name}" is now ${sc.active ? 'ACTIVE' : 'PAUSED'}.`
            };
        }

        if (sub === 'reorder' || sub === 'priority') {
            const target = args[1];
            const idsArg = args[2];
            if (!target || !idsArg) {
                return { success: false, output: '❌ Usage: schedule reorder <serverId> <id1,id2,...>' };
            }
            const srv = servers.find(s => String(s.id) === target || s.name.toLowerCase() === target.toLowerCase());
            if (!srv) return { success: false, output: `❌ Server "${target}" not found.` };

            const requestedIds = idsArg.split(',').map(s => s.trim()).filter(Boolean);
            const currentScheds = srv.schedules || [];
            const schedMap = new Map();
            currentScheds.forEach(s => schedMap.set(String(s.id), s));

            const reordered = [];
            for (const id of requestedIds) {
                if (schedMap.has(id)) {
                    reordered.push(schedMap.get(id));
                    schedMap.delete(id);
                }
            }
            for (const rem of schedMap.values()) {
                reordered.push(rem);
            }

            srv.schedules = reordered;
            config.servers = servers;
            this.saveConfig(config);
            return {
                success: true,
                output: `✅ Reordered ${reordered.length} schedules on "${srv.name}". New priority sequence:\n` +
                    reordered.map((sc, i) => `  #${i + 1}: ${sc.label} (ID: ${sc.id})`).join('\n')
            };
        }

        if (sub === 'move') {
            const target = args[1];
            const fromIdx = parseInt(args[2], 10) - 1;
            const toIdx = parseInt(args[3], 10) - 1;
            if (!target || isNaN(fromIdx) || isNaN(toIdx)) {
                return { success: false, output: '❌ Usage: schedule move <serverId> <fromPosition> <toPosition>\nExample: schedule move 179015 2 1 (moves 2nd schedule to 1st)' };
            }
            const srv = servers.find(s => String(s.id) === target || s.name.toLowerCase() === target.toLowerCase());
            if (!srv) return { success: false, output: `❌ Server "${target}" not found.` };

            const scheds = srv.schedules || [];
            if (fromIdx < 0 || fromIdx >= scheds.length || toIdx < 0 || toIdx >= scheds.length) {
                return { success: false, output: `❌ Position out of bounds. Server has ${scheds.length} schedules (positions 1 through ${scheds.length}).` };
            }

            const [moved] = scheds.splice(fromIdx, 1);
            scheds.splice(toIdx, 0, moved);

            srv.schedules = scheds;
            config.servers = servers;
            this.saveConfig(config);
            return {
                success: true,
                output: `✅ Moved schedule "${moved.label}" to position #${toIdx + 1}.\nNew sequence:\n` +
                    scheds.map((sc, i) => `  #${i + 1}: ${sc.label} (ID: ${sc.id})`).join('\n')
            };
        }

        return { success: false, output: '❌ Unknown schedule subcommand. Try "help schedule".' };
    }

    async cmdTrigger(args) {
        const srvId = args[0];
        const schedId = args[1];

        if (!srvId) {
            return { success: false, output: '❌ Usage: trigger <serverId|serverName> [scheduleId]' };
        }

        if (!this.daemonManager) {
            return { success: false, output: '❌ Daemon manager not connected. Make sure the server or daemon is spinning.' };
        }

        const config = this.getConfig();
        const srv = (config.servers || []).find(s => String(s.id) === srvId || s.name.toLowerCase() === srvId.toLowerCase());
        if (!srv) {
            return { success: false, output: `❌ Server profile "${srvId}" not found.` };
        }

        let targetSchedId = schedId;
        if (!targetSchedId && srv.schedules && srv.schedules.length > 0) {
            targetSchedId = srv.schedules[0].id;
        }

        if (!targetSchedId) {
            return { success: false, output: `❌ No schedules found for server "${srv.name}".` };
        }

        try {
            const res = await this.daemonManager.triggerTask(srv.id, targetSchedId, false);
            if (res.success) {
                return {
                    success: true,
                    output: `⚡ Attendance task executed successfully on [${srv.name}]!\nResult: ${res.message || 'OK'}`
                };
            } else {
                return {
                    success: false,
                    output: `❌ Execution failed on [${srv.name}]: ${res.error || res.message || 'Unknown error'}`
                };
            }
        } catch (err) {
            return { success: false, output: `❌ Trigger error: ${err.message}` };
        }
    }

    cmdLogs(args) {
        if (args[0] === 'clear') {
            if (this.logger && this.logger.clearHistory) {
                this.logger.clearHistory();
            }
            return { success: true, output: '🧹 Session activity logs cleared.' };
        }

        const count = parseInt(args[0], 10) || 15;
        const logs = (this.logger && this.logger.getHistory) ? this.logger.getHistory() : [];

        if (logs.length === 0) {
            return { success: true, output: 'No activity logs captured yet.' };
        }

        const slice = logs.slice(-count);
        const lines = [
            `📜 Recent Activity Logs (Last ${slice.length} of ${logs.length}):`,
            '─────────────────────────────────────────────────────────────'
        ];

        slice.forEach(e => {
            const time = e.time ? new Date(e.time).toLocaleTimeString() : '--:--';
            const lvl = (e.level || 'INFO').padEnd(7);
            lines.push(`[${time}] ${lvl} : ${e.message}`);
        });

        return { success: true, output: lines.join('\n') };
    }

    cmdToken(args) {
        const config = this.getConfig();
        const newToken = args[0];

        if (!newToken || newToken === 'show') {
            if (!config.globalToken) {
                return { success: false, output: '❌ No Discord User Token is currently configured.' };
            }
            return {
                success: true,
                output: `🔑 Current Token: ${config.globalToken.substring(0, 10)}... (Length: ${config.globalToken.length} characters)`
            };
        }

        config.globalToken = newToken.trim();
        this.saveConfig(config);
        return {
            success: true,
            output: `✅ Discord User Token updated (${config.globalToken.substring(0, 10)}...).`
        };
    }

    async cmdWebhook(args) {
        const config = this.getConfig();
        const sub = args[0];

        if (sub === 'test') {
            const url = args[1] || config.globalWebhookUrl;
            if (!url) {
                return { success: false, output: '❌ No webhook URL specified or configured.' };
            }

            if (this.daemonManager) {
                const res = await this.daemonManager.testWebhook(url);
                if (res.success) {
                    return { success: true, output: '✅ Discord webhook test notification delivered successfully!' };
                } else {
                    return { success: false, output: `❌ Webhook test failed: ${res.message || 'Error sending notification'}` };
                }
            }

            // Fallback direct HTTPS test
            const ok = await new Promise(resolve => {
                try {
                    const u = new URL(url);
                    const body = JSON.stringify({
                        embeds: [{
                            title: '🔔 AttendanceBot Webhook Test (CLI)',
                            description: 'Test notification from AttendanceBot CLI Engine.',
                            color: 5814783,
                            timestamp: new Date().toISOString()
                        }]
                    });
                    const req = https.request(u, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
                    }, r => resolve(r.statusCode >= 200 && r.statusCode < 300));
                    req.on('error', () => resolve(false));
                    req.write(body);
                    req.end();
                } catch (e) {
                    resolve(false);
                }
            });

            return ok
                ? { success: true, output: '✅ Discord webhook test notification delivered successfully!' }
                : { success: false, output: '❌ Failed to deliver webhook notification. Check the URL.' };
        }

        if (!sub) {
            return {
                success: true,
                output: config.globalWebhookUrl
                    ? `🔔 Configured Webhook: ${config.globalWebhookUrl}`
                    : '🔔 No global webhook configured. Use: webhook <url>'
            };
        }

        config.globalWebhookUrl = sub.trim();
        this.saveConfig(config);
        return {
            success: true,
            output: `✅ Global webhook URL updated: ${config.globalWebhookUrl.substring(0, 45)}...`
        };
    }

    cmdBackup() {
        const config = this.getConfig();
        return {
            success: true,
            output: JSON.stringify(config, null, 2)
        };
    }

    cmdUptime() {
        const config = this.getConfig();
        const servers = config.servers || [];
        const healthMap = (this.attendanceHistory && this.attendanceHistory.getServerHealthMap)
            ? this.attendanceHistory.getServerHealthMap(servers)
            : {};

        const lines = [
            '⏱️ Server Health & Check-in Reliability:',
            '─────────────────────────────────────────────────────────────'
        ];

        servers.forEach(s => {
            const h = healthMap[s.id] || {};
            const state = !s.active ? '⚪ PAUSED' : (h.health === 'FAILED' ? '🔴 FAILED' : '🟢 RUNNING');
            let lastSuccess = 'Never';
            if (h.lastSuccessfulAt) {
                const diffMs = Math.max(0, Date.now() - new Date(h.lastSuccessfulAt).getTime());
                lastSuccess = formatDuration(diffMs) + ' ago';
            }
            lines.push(`  • [${state}] "${s.name}" (Channel: ${s.channelId})`);
            lines.push(`      Uptime / Last Check-in: ${lastSuccess}`);
            lines.push(`      Recent Run Status     : ${h.lastRunStatus || 'None'}`);
        });

        return { success: true, output: lines.join('\n') };
    }

    async cmdValidate(args) {
        const filePath = args[0];
        if (!filePath) {
            return { success: false, output: '❌ Usage: validate <path/to/config.json>' };
        }
        const resolvedPath = path.resolve(process.cwd(), filePath);
        if (!fs.existsSync(resolvedPath)) {
            return { success: false, output: `❌ File not found: ${filePath}` };
        }
        try {
            const raw = fs.readFileSync(resolvedPath, 'utf8');
            const parsed = JSON.parse(raw);
            const res = validateConfigSchema(parsed);
            if (res.isValid) {
                let out = `✅ Schema Validation PASSED for "${path.basename(filePath)}"!\n`;
                out += `  • Servers Verified  : ${res.stats.serverCount}\n`;
                out += `  • Schedules Verified: ${res.stats.scheduleCount}\n`;
                if (res.warnings.length > 0) {
                    out += `\n⚠️ Warnings (${res.warnings.length}):\n` + res.warnings.map(w => `  • ${w}`).join('\n');
                }
                return { success: true, output: out };
            } else {
                let out = `❌ Schema Validation FAILED for "${path.basename(filePath)}":\n`;
                out += `Found ${res.errors.length} error(s):\n`;
                out += res.errors.map((e, idx) => `  ${idx + 1}. ${e}`).join('\n');
                if (res.warnings.length > 0) {
                    out += `\nWarnings (${res.warnings.length}):\n` + res.warnings.map(w => `  • ${w}`).join('\n');
                }
                return { success: false, output: out };
            }
        } catch (err) {
            return { success: false, output: `❌ JSON Parse Error in "${filePath}": ${err.message}` };
        }
    }

    async cmdImport(args) {
        const filePath = args[0];
        const mode = (args[1] || 'merge').toLowerCase();
        if (!filePath) {
            return { success: false, output: '❌ Usage: import <path/to/config.json> [merge|replace]' };
        }
        const resolvedPath = path.resolve(process.cwd(), filePath);
        if (!fs.existsSync(resolvedPath)) {
            return { success: false, output: `❌ File not found: ${filePath}` };
        }
        try {
            const raw = fs.readFileSync(resolvedPath, 'utf8');
            const parsed = JSON.parse(raw);
            const res = validateConfigSchema(parsed);
            if (!res.isValid) {
                let out = `❌ Import rejected: Schema validation failed for "${path.basename(filePath)}":\n`;
                out += res.errors.map((e, idx) => `  ${idx + 1}. ${e}`).join('\n');
                return { success: false, output: out };
            }

            const config = this.getConfig();
            const incomingServers = res.sanitized.servers;

            if (mode === 'merge') {
                incomingServers.forEach(incoming => {
                    const idx = config.servers.findIndex(s => String(s.id) === String(incoming.id));
                    if (idx >= 0) {
                        config.servers[idx] = incoming;
                    } else {
                        config.servers.push(incoming);
                    }
                });
            } else {
                config.servers = incomingServers;
            }

            if (res.sanitized.globalWebhookUrl && !config.globalWebhookUrl) {
                config.globalWebhookUrl = res.sanitized.globalWebhookUrl;
            }

            const saved = this.saveConfig(config);
            if (!saved) {
                return { success: false, output: '❌ Failed to save configuration to disk.' };
            }

            if (this.daemonManager && this.daemonManager.status === 'RUNNING') {
                this.daemonManager.initializeSchedules(config);
            }

            let out = `🎉 Successfully imported ${incomingServers.length} server profile(s) (${mode} mode) with schema validation passed!\n`;
            out += `Total servers configured: ${config.servers.length} | Schedules: ${res.stats.scheduleCount}`;
            if (res.warnings.length > 0) {
                out += `\n⚠️ Warnings:\n` + res.warnings.map(w => `  • ${w}`).join('\n');
            }
            return { success: true, output: out };
        } catch (err) {
            return { success: false, output: `❌ Import error: ${err.message}` };
        }
    }

    async cmdService(args) {
        const sub = (args[0] || 'status').toLowerCase();
        const runExec = (cmd) => new Promise((resolve) => {
            exec(cmd, { cwd: path.join(__dirname, '..') }, (err, stdout, stderr) => {
                resolve((stdout || stderr || '').trim());
            });
        });

        if (sub === 'status') {
            const out = await runExec('npx pm2 status attendanceBot-daemon');
            return { success: true, output: out || 'PM2 service check completed.' };
        }
        if (sub === 'install' || sub === 'start') {
            const out = await runExec('node bin/install-service.js');
            return { success: true, output: out || 'Service installed.' };
        }
        if (sub === 'uninstall' || sub === 'stop') {
            const out = await runExec('node bin/uninstall-service.js');
            return { success: true, output: out || 'Service uninstalled.' };
        }
        if (sub === 'logs') {
            const lines = args[1] || '20';
            const out = await runExec(`npx pm2 logs attendanceBot-daemon --lines ${lines} --nostream`);
            return { success: true, output: out || 'No PM2 logs available.' };
        }
        return {
            success: false,
            output: '❌ Usage: service <status|install|uninstall|logs [lines]>'
        };
    }
}

module.exports = CliEngine;
