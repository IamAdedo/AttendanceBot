const express = require('express');
const path = require('path');
const fs = require('fs');
const daemonManager = require('./src/daemonManager');
const logger = require('./src/logger');
const attendanceHistory = require('./src/attendanceHistory');
const CliEngine = require('./src/cliEngine');

const { validateConfigSchema } = require('./src/schemaValidator');

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

const cliEngine = new CliEngine({ daemonManager, logger, attendanceHistory });

// Bidirectional hot-sync: Watch config.json for external CLI or editor changes
const CONFIG_FILE_PATH = path.join(__dirname, 'config.json');
let configWatchDebounce = null;
if (fs.existsSync(CONFIG_FILE_PATH)) {
    fs.watchFile(CONFIG_FILE_PATH, { interval: 1000 }, (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs) {
            clearTimeout(configWatchDebounce);
            configWatchDebounce = setTimeout(() => {
                daemonManager.reloadConfigFromDisk();
            }, 300);
        }
    });
}

// CORS and security headers for iframe / dev environment proxying
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- REST API Endpoints ---

// Get daemon and application status
app.get('/api/status', (req, res) => {
    try {
        res.json(daemonManager.getStatus());
    } catch (err) {
        logger.error(`Error in /api/status: ${err.message}`);
        res.status(500).json({ error: 'Failed to retrieve status', details: err.message });
    }
});

// Get current config
app.get('/api/config', (req, res) => {
    try {
        const config = daemonManager.getConfig();
        // Return config with full info (or masked token preview)
        res.json({
            ...config,
            hasToken: Boolean(config.globalToken && config.globalToken.trim()),
            tokenPreview: config.globalToken ? `${config.globalToken.substring(0, 8)}...` : '',
        });
    } catch (err) {
        logger.error(`Error in /api/config: ${err.message}`);
        res.status(500).json({ error: 'Failed to retrieve config', details: err.message });
    }
});

// Save whole config or update global settings
app.post('/api/config', (req, res) => {
    const current = daemonManager.getConfig();
    const { globalToken, globalWebhookUrl, servers } = req.body;

    if (globalToken !== undefined) current.globalToken = globalToken.trim();
    if (globalWebhookUrl !== undefined) current.globalWebhookUrl = globalWebhookUrl.trim();
    if (Array.isArray(servers)) current.servers = servers;

    const saved = daemonManager.saveConfig(current);
    if (!saved) {
        return res.status(500).json({ error: 'Failed to save configuration' });
    }

    if (daemonManager.status === 'RUNNING') {
        daemonManager.initializeSchedules(current);
    }

    logger.info('Configuration updated via Web Dashboard');
    res.json({ success: true, config: current });
});

// Bulk toggle monitoring status for all servers (Enable All / Disable All)
app.post('/api/servers/toggle-all', (req, res) => {
    const { active } = req.body;
    if (active === undefined) {
        return res.status(400).json({ error: 'active boolean flag is required' });
    }

    const config = daemonManager.getConfig();
    const shouldEnable = Boolean(active);
    (config.servers || []).forEach((s) => {
        s.active = shouldEnable;
    });

    const saved = daemonManager.saveConfig(config);
    if (!saved) {
        return res.status(500).json({ error: 'Failed to save configuration' });
    }

    if (daemonManager.status === 'RUNNING') {
        daemonManager.initializeSchedules(config);
    }

    const statusLabel = shouldEnable ? 'Enabled all' : 'Disabled all';
    logger.info(`${statusLabel} server profiles (${config.servers.length} servers total).`);
    res.json({ success: true, active: shouldEnable, count: config.servers.length, servers: config.servers });
});

// Export server profiles and schedules configuration
app.get('/api/config/export', (req, res) => {
    const config = daemonManager.getConfig();
    const exportData = {
        app: 'AttendanceBot',
        version: '3.3.0',
        exportedAt: new Date().toISOString(),
        globalWebhookUrl: config.globalWebhookUrl || '',
        servers: config.servers || [],
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="attendancebot-servers-config.json"');
    res.json(exportData);
});

// Pre-validate configuration schema before committing import
app.post('/api/config/validate', (req, res) => {
    const validation = validateConfigSchema(req.body);
    res.json({
        isValid: validation.isValid,
        errors: validation.errors,
        warnings: validation.warnings,
        stats: validation.stats
    });
});

// Import server profiles and schedules configuration with strict schema validation
app.post('/api/config/import', (req, res) => {
    const { mode = 'replace', globalWebhookUrl } = req.body;

    // Run deep schema validation
    const validation = validateConfigSchema(req.body);
    if (!validation.isValid) {
        logger.warn(`Config import rejected: ${validation.errors.length} schema validation error(s).`);
        return res.status(400).json({
            error: 'Configuration failed schema validation.',
            errors: validation.errors,
            warnings: validation.warnings,
            stats: validation.stats
        });
    }

    const sanitizedServers = validation.sanitized.servers;
    const config = daemonManager.getConfig();

    if (mode === 'merge') {
        sanitizedServers.forEach((incoming) => {
            const existingIdx = config.servers.findIndex((s) => String(s.id) === String(incoming.id));
            if (existingIdx >= 0) {
                config.servers[existingIdx] = incoming;
            } else {
                config.servers.push(incoming);
            }
        });
    } else {
        // Replace
        config.servers = sanitizedServers;
    }

    const importedWebhook = globalWebhookUrl || validation.sanitized.globalWebhookUrl;
    if (importedWebhook && !config.globalWebhookUrl) {
        config.globalWebhookUrl = importedWebhook.trim();
    }

    const saved = daemonManager.saveConfig(config);
    if (!saved) {
        return res.status(500).json({ error: 'Failed to persist imported configuration to disk.' });
    }

    if (daemonManager.status === 'RUNNING') {
        daemonManager.initializeSchedules(config);
    }

    logger.success(`Successfully imported ${sanitizedServers.length} server profile(s) (${mode} mode) with schema validation passed.`);
    res.json({
        success: true,
        count: sanitizedServers.length,
        warnings: validation.warnings,
        stats: validation.stats,
        servers: config.servers
    });
});

// Start Daemon
app.post('/api/daemon/start', async (req, res) => {
    const result = await daemonManager.start();
    res.json(result);
});

// Stop Daemon
app.post('/api/daemon/stop', async (req, res) => {
    const result = await daemonManager.stop();
    res.json(result);
});

// Add a Server Profile
app.post('/api/servers', (req, res) => {
    const { name, channelId, webhookUrl, active } = req.body;
    if (!name || !channelId) {
        return res.status(400).json({ error: 'Server name and Channel ID are required' });
    }

    const config = daemonManager.getConfig();
    const cleanChan = channelId.trim();
    const cleanName = name.trim();

    // Check for duplicate server profile by channel ID or server name
    const existing = (config.servers || []).find(
        (s) => (s.channelId && s.channelId.trim() === cleanChan) ||
               (s.name && s.name.trim().toLowerCase() === cleanName.toLowerCase())
    );

    if (existing) {
        return res.status(409).json({
            error: `Server profile already exists: "${existing.name}" (Channel: ${existing.channelId})`,
            duplicate: true,
            existingServer: existing,
        });
    }

    const newServer = {
        id: Date.now().toString(),
        name: cleanName,
        channelId: cleanChan,
        webhookUrl: (webhookUrl || '').trim(),
        active: active !== undefined ? Boolean(active) : true,
        schedules: [],
    };

    config.servers.push(newServer);
    daemonManager.saveConfig(config);
    logger.success(`Created server profile: "${newServer.name}"`);
    res.status(201).json({ success: true, server: newServer });
});

// Update a Server Profile
app.put('/api/servers/:serverId', (req, res) => {
    const { serverId } = req.params;
    const { name, channelId, webhookUrl, active } = req.body;
    const config = daemonManager.getConfig();
    const server = config.servers.find((s) => String(s.id) === String(serverId));

    if (!server) {
        return res.status(404).json({ error: 'Server not found' });
    }

    if (name !== undefined) server.name = name.trim();
    if (channelId !== undefined) server.channelId = channelId.trim();
    if (webhookUrl !== undefined) server.webhookUrl = (webhookUrl || '').trim();
    if (active !== undefined) server.active = Boolean(active);

    daemonManager.saveConfig(config);
    logger.info(`Updated server profile: "${server.name}"`);
    res.json({ success: true, server });
});

// Delete a Server Profile
app.delete('/api/servers/:serverId', (req, res) => {
    const { serverId } = req.params;
    const config = daemonManager.getConfig();
    const idx = config.servers.findIndex((s) => String(s.id) === String(serverId));

    if (idx === -1) {
        return res.status(404).json({ error: 'Server not found' });
    }

    const removed = config.servers.splice(idx, 1)[0];
    daemonManager.saveConfig(config);
    logger.warn(`Deleted server profile: "${removed.name}"`);
    res.json({ success: true, message: `Server ${removed.name} removed` });
});

// Bulk Action on Selected Server Profiles (Delete, Enable, Disable)
app.post('/api/servers/bulk-action', (req, res) => {
    const { action, serverIds } = req.body;
    if (!action || !Array.isArray(serverIds) || serverIds.length === 0) {
        return res.status(400).json({ error: 'Valid action and non-empty serverIds array are required' });
    }

    const config = daemonManager.getConfig();
    const idSet = new Set(serverIds.map(String));
    let affectedCount = 0;

    if (action === 'delete') {
        const initialLen = config.servers.length;
        config.servers = config.servers.filter(s => !idSet.has(String(s.id)));
        affectedCount = initialLen - config.servers.length;
        daemonManager.saveConfig(config);
        logger.warn(`Bulk deleted ${affectedCount} server profile(s).`);
        return res.json({ success: true, action: 'delete', count: affectedCount });
    }

    if (action === 'enable' || action === 'disable') {
        const setActive = (action === 'enable');
        config.servers.forEach(s => {
            if (idSet.has(String(s.id))) {
                s.active = setActive;
                affectedCount++;
            }
        });
        daemonManager.saveConfig(config);
        logger.info(`Bulk ${setActive ? 'enabled' : 'disabled'} ${affectedCount} server profile(s).`);
        return res.json({ success: true, action, count: affectedCount });
    }

    return res.status(400).json({ error: `Unknown bulk action: ${action}` });
});

// Add a Schedule to a Server
app.post('/api/servers/:serverId/schedules', (req, res) => {
    const { serverId } = req.params;
    const { label, cron, message, attendanceType, emoji, targetMessageId, maxJitterMinutes, active, type, runDate } = req.body;

    if (!cron || !label) {
        return res.status(400).json({ error: 'Label and cron expression are required' });
    }

    const config = daemonManager.getConfig();
    const server = config.servers.find((s) => String(s.id) === String(serverId));
    if (!server) {
        return res.status(404).json({ error: 'Server not found' });
    }

    const newSchedule = {
        id: Date.now().toString() + Math.floor(Math.random() * 1000),
        label: label.trim(),
        cron: cron.trim(),
        message: message !== undefined ? message : 'Present',
        attendanceType: (attendanceType || 'MESSAGE').toUpperCase(),
        emoji: emoji || '👍',
        targetMessageId: targetMessageId ? targetMessageId.trim() : '',
        maxJitterMinutes: Number(maxJitterMinutes) >= 0 ? Number(maxJitterMinutes) : 10,
        active: active !== undefined ? Boolean(active) : true,
    };

    if (type === 'ONCE') {
        newSchedule.type = 'ONCE';
        if (runDate) newSchedule.runDate = runDate;
    }

    if (!server.schedules) server.schedules = [];
    server.schedules.push(newSchedule);

    daemonManager.saveConfig(config);
    logger.success(`[${server.name}] Added schedule: "${newSchedule.label}"`);
    res.status(201).json({ success: true, schedule: newSchedule });
});

// Update a Schedule
app.put('/api/servers/:serverId/schedules/:scheduleId', (req, res) => {
    const { serverId, scheduleId } = req.params;
    const config = daemonManager.getConfig();
    const server = config.servers.find((s) => String(s.id) === String(serverId));
    if (!server) {
        return res.status(404).json({ error: 'Server not found' });
    }

    const schedule = (server.schedules || []).find((sc) => String(sc.id) === String(scheduleId));
    if (!schedule) {
        return res.status(404).json({ error: 'Schedule not found' });
    }

    const { label, cron, message, attendanceType, emoji, targetMessageId, maxJitterMinutes, active, type, runDate } = req.body;

    if (label !== undefined) schedule.label = label.trim();
    if (cron !== undefined) schedule.cron = cron.trim();
    if (message !== undefined) schedule.message = message;
    if (attendanceType !== undefined) schedule.attendanceType = attendanceType.toUpperCase();
    if (emoji !== undefined) schedule.emoji = emoji;
    if (targetMessageId !== undefined) schedule.targetMessageId = targetMessageId ? targetMessageId.trim() : '';
    if (maxJitterMinutes !== undefined) schedule.maxJitterMinutes = Number(maxJitterMinutes);
    if (active !== undefined) schedule.active = Boolean(active);
    if (type !== undefined) schedule.type = type;
    if (runDate !== undefined) schedule.runDate = runDate;

    daemonManager.saveConfig(config);
    logger.info(`[${server.name}] Updated schedule: "${schedule.label}"`);
    res.json({ success: true, schedule });
});

// Delete a Schedule
app.delete('/api/servers/:serverId/schedules/:scheduleId', (req, res) => {
    const { serverId, scheduleId } = req.params;
    const config = daemonManager.getConfig();
    const server = config.servers.find((s) => String(s.id) === String(serverId));
    if (!server) {
        return res.status(404).json({ error: 'Server not found' });
    }

    const idx = (server.schedules || []).findIndex((sc) => String(sc.id) === String(scheduleId));
    if (idx === -1) {
        return res.status(404).json({ error: 'Schedule not found' });
    }

    const removed = server.schedules.splice(idx, 1)[0];
    daemonManager.saveConfig(config);
    logger.warn(`[${server.name}] Deleted schedule: "${removed.label}"`);
    res.json({ success: true, message: `Schedule ${removed.label} deleted` });
});

// Reorder schedules for a server profile (Drag-and-Drop sequence prioritization)
app.post('/api/servers/:serverId/schedules/reorder', (req, res) => {
    const { serverId } = req.params;
    const { scheduleIds, schedules } = req.body;

    const config = daemonManager.getConfig();
    const server = config.servers.find((s) => String(s.id) === String(serverId));
    if (!server) {
        return res.status(404).json({ error: 'Server not found' });
    }

    if (Array.isArray(scheduleIds)) {
        const scheduleMap = new Map((server.schedules || []).map((sc) => [String(sc.id), sc]));
        const reordered = [];
        scheduleIds.forEach((id) => {
            const sc = scheduleMap.get(String(id));
            if (sc) {
                reordered.push(sc);
                scheduleMap.delete(String(id));
            }
        });
        // Append any omitted schedules to prevent data loss
        scheduleMap.forEach((sc) => reordered.push(sc));
        server.schedules = reordered;
    } else if (Array.isArray(schedules)) {
        server.schedules = schedules;
    } else {
        return res.status(400).json({ error: 'scheduleIds array or schedules array is required' });
    }

    const saved = daemonManager.saveConfig(config);
    if (!saved) {
        return res.status(500).json({ error: 'Failed to save configuration' });
    }

    if (daemonManager.status === 'RUNNING') {
        daemonManager.initializeSchedules(config);
    }

    logger.info(`[${server.name}] Attendance schedules reordered for prioritized execution sequence.`);
    res.json({ success: true, server, schedules: server.schedules });
});

// Test Webhook Dispatch
app.post('/api/test-webhook', async (req, res) => {
    const { webhookUrl } = req.body;
    const targetUrl = webhookUrl || daemonManager.getConfig().globalWebhookUrl;
    if (!targetUrl) {
        return res.status(400).json({ success: false, message: 'No webhook URL provided or configured.' });
    }

    logger.info(`Testing Discord Webhook dispatch to: ${targetUrl.substring(0, 40)}...`);
    const result = await daemonManager.testWebhook(targetUrl);
    if (result.success) {
        logger.success('Discord Webhook test notification delivered successfully!');
    } else {
        logger.error(`Discord Webhook test failed: ${result.message}`);
    }
    res.json(result);
});

// Trigger a Schedule Immediately (Test Run)
app.post('/api/servers/:serverId/schedules/:scheduleId/trigger', async (req, res) => {
    const { serverId, scheduleId } = req.params;
    const { simulate } = req.body;
    try {
        const result = await daemonManager.triggerTask(serverId, scheduleId, simulate);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Activity Logs Endpoint
app.get('/api/logs', (req, res) => {
    res.json({ logs: logger.getHistory() });
});

// Export Activity Logs as CSV file
app.get('/api/logs/export', (req, res) => {
    const logs = logger.getHistory() || [];
    const escapeCsv = (val) => {
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
    };

    const header = ['Entry #', 'Timestamp', 'Level', 'Message'];
    const rows = logs.map((entry, idx) => [
        idx + 1,
        escapeCsv(entry.time || ''),
        escapeCsv(entry.level || 'INFO'),
        escapeCsv(entry.message || '')
    ].join(','));

    const csvContent = '\uFEFF' + [header.join(','), ...rows].join('\r\n');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `attendancebot-activity-logs-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
});

// Daily Check-ins Statistics (30 days)
app.get('/api/stats/daily-checkins', (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 90);
    res.json(attendanceHistory.getDailyStats(days));
});

// Server Health Status Map
app.get('/api/servers/health', (req, res) => {
    const config = daemonManager.getConfig();
    res.json({ healthMap: attendanceHistory.getServerHealthMap(config.servers || []) });
});

// Clear Activity Logs
app.post('/api/logs/clear', (req, res) => {
    logger.clearHistory();
    logger.info('Activity logs cleared by user.');
    res.json({ success: true });
});

// Interactive CLI Command Execution Endpoint (Web Terminal & Remote CLI)
app.post('/api/cli/exec', async (req, res) => {
    const { command, cmd } = req.body;
    const commandToRun = (command || cmd || '').trim();

    if (!commandToRun) {
        return res.json({ success: true, output: '', command: '' });
    }

    try {
        const result = await cliEngine.execute(commandToRun);
        res.json({
            success: result.success,
            output: result.output,
            command: commandToRun,
            isClear: Boolean(result.isClear)
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            output: `Internal CLI error: ${err.message}`,
            command: commandToRun
        });
    }
});

// Server-Sent Events (SSE) for Real-Time Log Streaming
app.get('/api/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const listener = (logEntry) => {
        res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
    };

    logger.addListener(listener);

    // Initial ping
    res.write(`data: ${JSON.stringify({ time: new Date().toISOString(), level: 'INFO', message: 'Connected to live log stream.' })}\n\n`);

    req.on('close', () => {
        logger.removeListener(listener);
        res.end();
    });
});

// Missing API endpoint 404 handler (prevents returning HTML to fetch calls)
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// Fallback index.html for SPA/Web dashboard
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Express Server
app.listen(PORT, HOST, () => {
    logger.success(`AttendanceBot Web Dashboard online and listening at http://${HOST}:${PORT}`);
});
