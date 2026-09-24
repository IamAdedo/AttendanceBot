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
                this.history = [];
                this.save();
            }
        } catch (err) {
            console.error('[AttendanceHistory] Error loading history:', err.message);
            this.history = [];
        }
    }

    save() {
        try {
            fs.writeFileSync(HISTORY_PATH, JSON.stringify(this.history, null, 2), 'utf8');
        } catch (err) {
            console.error('[AttendanceHistory] Error saving history:', err.message);
        }
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

        const successRate = totalCheckins > 0 ? ((totalSuccess / totalCheckins) * 100).toFixed(1) : '0.0';
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
