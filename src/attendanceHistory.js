const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '..', 'attendance_history.json');
const MAX_HISTORY = 1000;

class AttendanceHistory {
    constructor() {
        this.history = [];
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(HISTORY_PATH)) {
                const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
                this.history = JSON.parse(raw);
                if (!Array.isArray(this.history)) this.history = [];
            } else {
                this.seedInitialHistory();
            }
        } catch (err) {
            console.error('[AttendanceHistory] Error loading history:', err.message);
            this.seedInitialHistory();
        }

        if (this.history.length === 0) {
            this.seedInitialHistory();
        }
    }

    save() {
        try {
            fs.writeFileSync(HISTORY_PATH, JSON.stringify(this.history, null, 2), 'utf8');
        } catch (err) {
            console.error('[AttendanceHistory] Error saving history:', err.message);
        }
    }

    seedInitialHistory() {
        const seeded = [];
        const now = new Date('2026-09-16T09:00:00Z');
        const servers = [
            { id: '1', name: 'Work / Study Server', channelId: '1234567890123456789' },
            { id: 'test_server_conflict', name: 'Math Department Discord', channelId: '987654321098765432' }
        ];

        // Seed 30 days of check-in activity
        for (let d = 29; d >= 0; d--) {
            const targetDate = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
            const dayOfWeek = targetDate.getUTCDay(); // 0 = Sun, 6 = Sat
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

            // Generate daily check-ins
            const count = isWeekend ? (Math.random() > 0.7 ? 1 : 0) : Math.floor(Math.random() * 3) + 2;

            for (let i = 0; i < count; i++) {
                const server = servers[i % servers.length];
                const hour = 9 + Math.floor(Math.random() * 8);
                const minute = Math.floor(Math.random() * 59);
                const recordTime = new Date(targetDate);
                recordTime.setUTCHours(hour, minute, Math.floor(Math.random() * 50), 0);

                // Small realistic failure rate (~3%)
                const isFail = d === 12 && i === 1;
                const isReaction = i % 2 === 1;

                seeded.push({
                    id: `att_${recordTime.getTime()}_${i}`,
                    timestamp: recordTime.toISOString(),
                    date: recordTime.toISOString().slice(0, 10),
                    serverId: server.id,
                    serverName: server.name,
                    channelId: server.channelId,
                    scheduleId: `sched_${i + 1}`,
                    scheduleLabel: isReaction ? 'Afternoon Rollcall' : 'Morning Check-in',
                    type: isReaction ? 'REACTION' : 'MESSAGE',
                    status: isFail ? 'FAILED' : 'SUCCESS',
                    error: isFail ? 'Discord API 429: Rate limit exceeded on route /channels/messages' : null,
                    details: isFail ? 'Failed to post attendance message' : (isReaction ? 'Reacted with 👍 to latest attendance post' : 'Posted "Present" successfully')
                });
            }
        }

        seeded.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        this.history = seeded;
        this.save();
    }

    recordExecution({ serverId, serverName, channelId, scheduleId, scheduleLabel, type, status, error, details }) {
        const timestamp = new Date().toISOString();
        const date = timestamp.slice(0, 10);

        const entry = {
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            timestamp,
            date,
            serverId: String(serverId || ''),
            serverName: serverName || 'Unknown Server',
            channelId: channelId || '',
            scheduleId: String(scheduleId || ''),
            scheduleLabel: scheduleLabel || 'Attendance Schedule',
            type: (type || 'MESSAGE').toUpperCase(),
            status: status === 'FAILED' ? 'FAILED' : 'SUCCESS',
            error: error || null,
            details: details || (status === 'SUCCESS' ? 'Attendance executed successfully' : 'Attendance execution failed')
        };

        this.history.push(entry);
        if (this.history.length > MAX_HISTORY) {
            this.history.shift();
        }

        this.save();
        return entry;
    }

    getDailyStats(days = 30) {
        const result = [];
        const now = new Date();
        const datesMap = {};

        // Generate day buckets for the past `days`
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const dateKey = d.toISOString().slice(0, 10);
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const displayLabel = `${monthNames[d.getMonth()]} ${d.getDate()}`;
            const weekday = dayNames[d.getDay()];

            datesMap[dateKey] = {
                date: dateKey,
                label: displayLabel,
                weekday,
                checkins: 0,
                success: 0,
                failed: 0,
            };
        }

        // Tally records
        this.history.forEach((item) => {
            if (datesMap[item.date]) {
                datesMap[item.date].checkins++;
                if (item.status === 'SUCCESS') {
                    datesMap[item.date].success++;
                } else {
                    datesMap[item.date].failed++;
                }
            }
        });

        const dailyList = Object.values(datesMap);
        let totalCheckins = 0;
        let totalSuccess = 0;
        let peakValue = 0;
        let peakDate = null;

        dailyList.forEach((day) => {
            totalCheckins += day.checkins;
            totalSuccess += day.success;
            if (day.checkins > peakValue) {
                peakValue = day.checkins;
                peakDate = `${day.label} (${day.checkins} check-ins)`;
            }
        });

        const successRate = totalCheckins > 0 ? ((totalSuccess / totalCheckins) * 100).toFixed(1) : '100.0';
        const avgDaily = (totalCheckins / days).toFixed(1);

        return {
            daily: dailyList,
            summary: {
                days,
                totalCheckins,
                totalSuccess,
                totalFailed: totalCheckins - totalSuccess,
                successRate: `${successRate}%`,
                avgDaily,
                peakDay: peakDate || 'None yet'
            }
        };
    }

    getServerHealthMap(servers = []) {
        const healthMap = {};

        servers.forEach((server) => {
            const serverId = String(server.id);
            const serverRecords = this.history.filter((h) => String(h.serverId) === serverId);
            const lastRecord = serverRecords[serverRecords.length - 1];

            let status = 'RUNNING';
            if (!server.active) {
                status = 'DISABLED';
            } else if (lastRecord && lastRecord.status === 'FAILED') {
                status = 'FAILED';
            } else {
                status = 'RUNNING';
            }

            const successRecords = serverRecords.filter((r) => r.status === 'SUCCESS');
            const lastSuccessRecord = successRecords[successRecords.length - 1];
            const successCount = successRecords.length;
            const failCount = serverRecords.filter((r) => r.status === 'FAILED').length;

            healthMap[serverId] = {
                serverId,
                serverName: server.name,
                active: Boolean(server.active),
                health: status, // 'RUNNING' | 'FAILED' | 'DISABLED'
                lastRunAt: lastRecord ? lastRecord.timestamp : null,
                lastRunStatus: lastRecord ? lastRecord.status : null,
                lastRunLabel: lastRecord ? lastRecord.scheduleLabel : null,
                lastSuccessfulAt: lastSuccessRecord ? lastSuccessRecord.timestamp : null,
                lastError: lastRecord && lastRecord.error ? lastRecord.error : null,
                totalSuccess: successCount,
                totalFailed: failCount,
                recentExecutions: serverRecords.slice(-5)
            };
        });

        return healthMap;
    }
}

const attendanceHistory = new AttendanceHistory();
module.exports = attendanceHistory;
