/**
 * src/schemaValidator.js
 *
 * Comprehensive JSON Schema Validator for AttendanceBot server profiles and schedules.
 * Validates configuration exports/imports to ensure structural conformity and data integrity.
 *
 * Version: 3.7.0
 */

const cron = require('node-cron');
const { VERSION } = require('./version');

/**
 * Validates Discord snowflake IDs (channelId, messageId, etc.)
 * Snowflakes are 15-22 digit numeric strings.
 */
function isValidSnowflake(id) {
    if (!id) return false;
    const str = String(id).trim();
    return /^\d{15,22}$/.test(str);
}

/**
 * Validates URL format
 */
function isValidUrl(url) {
    if (!url) return false;
    try {
        const u = new URL(String(url).trim());
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

/**
 * Validates an entire import payload (file or object).
 *
 * @param {Object|Array} data - The parsed JSON data
 * @returns {Object} { isValid: boolean, errors: string[], warnings: string[], sanitized: Object, stats: Object }
 */
function validateConfigSchema(data) {
    const errors = [];
    const warnings = [];

    if (!data || (typeof data !== 'object' && !Array.isArray(data))) {
        return {
            isValid: false,
            errors: ['The uploaded data is empty or not a valid JSON object/array.'],
            warnings: [],
            sanitized: null,
            stats: { serverCount: 0, scheduleCount: 0 }
        };
    }

    let serversArray = [];
    let globalWebhook = '';
    let globalToken = '';

    if (Array.isArray(data)) {
        serversArray = data;
    } else {
        if (Array.isArray(data.servers)) {
            serversArray = data.servers;
        } else if (data.name && (data.channelId !== undefined)) {
            // Single server profile object
            serversArray = [data];
        } else {
            errors.push('Configuration root must contain a "servers" array of server profiles.');
        }

        if (data.globalWebhookUrl && typeof data.globalWebhookUrl === 'string') {
            globalWebhook = data.globalWebhookUrl.trim();
            if (globalWebhook && !isValidUrl(globalWebhook)) {
                warnings.push(`Global Webhook URL "${globalWebhook.substring(0, 30)}..." does not appear to be a standard URL.`);
            }
        }

        if (data.globalToken && typeof data.globalToken === 'string') {
            globalToken = data.globalToken.trim();
        }
    }

    if (errors.length > 0) {
        return {
            isValid: false,
            errors,
            warnings,
            sanitized: null,
            stats: { serverCount: 0, scheduleCount: 0 }
        };
    }

    if (serversArray.length === 0) {
        errors.push('Configuration must contain at least one server profile in the "servers" list.');
        return {
            isValid: false,
            errors,
            warnings,
            sanitized: null,
            stats: { serverCount: 0, scheduleCount: 0 }
        };
    }

    const seenChannelIds = new Set();
    const seenServerNames = new Set();
    const sanitizedServers = [];
    let totalSchedules = 0;

    serversArray.forEach((srv, sIdx) => {
        const srvNum = sIdx + 1;
        const prefix = `Server #${srvNum}` + (srv && srv.name ? ` ("${srv.name}")` : '');

        if (!srv || typeof srv !== 'object') {
            errors.push(`${prefix}: Must be a JSON object representing a server profile.`);
            return;
        }

        // 1. Name validation
        const name = (srv.name !== undefined && srv.name !== null) ? String(srv.name).trim() : '';
        if (!name) {
            errors.push(`Server #${srvNum}: "name" is required and cannot be blank.`);
        } else if (name.length > 100) {
            errors.push(`${prefix}: "name" is too long (maximum 100 characters).`);
        }

        // Duplicate name warning
        const lowerName = name.toLowerCase();
        if (lowerName && seenServerNames.has(lowerName)) {
            warnings.push(`${prefix}: Duplicate server name "${name}" detected in the import list.`);
        } else if (lowerName) {
            seenServerNames.add(lowerName);
        }

        // 2. Channel ID validation
        const channelIdRaw = (srv.channelId !== undefined && srv.channelId !== null) ? String(srv.channelId).trim() : '';
        if (!channelIdRaw) {
            errors.push(`${prefix}: "channelId" is required (Discord channel snowflake).`);
        } else if (!/^\d+$/.test(channelIdRaw)) {
            errors.push(`${prefix}: "channelId" must contain numeric digits only (received "${channelIdRaw}").`);
        } else if (channelIdRaw.length < 15 || channelIdRaw.length > 22) {
            warnings.push(`${prefix}: Channel ID "${channelIdRaw}" has an unusual length (${channelIdRaw.length} digits). Standard Discord snowflakes are 17-19 digits.`);
        }

        if (channelIdRaw && seenChannelIds.has(channelIdRaw)) {
            warnings.push(`${prefix}: Channel ID "${channelIdRaw}" is duplicated across multiple server entries in this file.`);
        } else if (channelIdRaw) {
            seenChannelIds.add(channelIdRaw);
        }

        // 3. Webhook URL validation
        const webhookUrl = (srv.webhookUrl !== undefined && srv.webhookUrl !== null) ? String(srv.webhookUrl).trim() : '';
        if (webhookUrl && !isValidUrl(webhookUrl)) {
            warnings.push(`${prefix}: Webhook URL "${webhookUrl.substring(0, 30)}..." does not appear to be a standard URL.`);
        }

        // 4. Active boolean
        const active = srv.active !== undefined ? Boolean(srv.active) : true;

        // 5. Schedules validation
        const schedulesRaw = srv.schedules;
        const sanitizedSchedules = [];

        if (schedulesRaw !== undefined && schedulesRaw !== null) {
            if (!Array.isArray(schedulesRaw)) {
                errors.push(`${prefix}: "schedules" must be an array of schedule routines.`);
            } else {
                schedulesRaw.forEach((sc, scIdx) => {
                    const scNum = scIdx + 1;
                    const scLabel = (sc && sc.label) ? ` ("${sc.label}")` : '';
                    const scPrefix = `${prefix} -> Schedule #${scNum}${scLabel}`;

                    if (!sc || typeof sc !== 'object') {
                        errors.push(`${scPrefix}: Must be a JSON object representing a schedule routine.`);
                        return;
                    }

                    // Cron expression
                    const cronExp = (sc.cron !== undefined && sc.cron !== null) ? String(sc.cron).trim() : '';
                    if (!cronExp) {
                        errors.push(`${scPrefix}: "cron" expression is required.`);
                    } else if (!cron.validate(cronExp)) {
                        errors.push(`${scPrefix}: Invalid cron expression syntax "${cronExp}". Must be 5-part cron syntax (e.g. "0 9 * * 1-5").`);
                    }

                    // Attendance type
                    const rawType = (sc.attendanceType || 'MESSAGE').toUpperCase().trim();
                    if (rawType !== 'MESSAGE' && rawType !== 'REACTION') {
                        errors.push(`${scPrefix}: "attendanceType" must be either "MESSAGE" or "REACTION" (received "${rawType}").`);
                    }

                    // Mode payload validation
                    let message = sc.message !== undefined ? String(sc.message) : 'Present';
                    let emoji = sc.emoji !== undefined ? String(sc.emoji).trim() : '👍';
                    let targetMessageId = sc.targetMessageId !== undefined ? String(sc.targetMessageId).trim() : '';

                    if (rawType === 'MESSAGE' && !message) {
                        warnings.push(`${scPrefix}: Message is empty; defaulting to "Present".`);
                        message = 'Present';
                    }

                    if (rawType === 'REACTION') {
                        if (!emoji) {
                            errors.push(`${scPrefix}: An emoji reaction is required when attendanceType is "REACTION".`);
                        }
                        if (targetMessageId && !/^\d+$/.test(targetMessageId)) {
                            warnings.push(`${scPrefix}: Target Message ID "${targetMessageId}" should contain numeric digits only.`);
                        }
                    }

                    // Max jitter minutes
                    let maxJitterMinutes = 10;
                    if (sc.maxJitterMinutes !== undefined) {
                        const parsedJitter = parseInt(sc.maxJitterMinutes, 10);
                        if (isNaN(parsedJitter) || parsedJitter < 0) {
                            warnings.push(`${scPrefix}: "maxJitterMinutes" was invalid (${sc.maxJitterMinutes}); defaulted to 10.`);
                        } else if (parsedJitter > 120) {
                            warnings.push(`${scPrefix}: "maxJitterMinutes" (${parsedJitter}m) is unusually high (> 2 hours).`);
                            maxJitterMinutes = parsedJitter;
                        } else {
                            maxJitterMinutes = parsedJitter;
                        }
                    }

                    // Schedule label
                    const label = sc.label ? String(sc.label).trim() : `Schedule #${scNum} (${cronExp})`;

                    // Once / RunDate validation
                    let isOnce = sc.type === 'ONCE';
                    let runDate = undefined;
                    if (sc.runDate) {
                        const parsedDate = new Date(sc.runDate);
                        if (isNaN(parsedDate.getTime())) {
                            warnings.push(`${scPrefix}: "runDate" ("${sc.runDate}") is not a valid date string.`);
                        } else {
                            runDate = parsedDate.toISOString();
                            isOnce = true;
                        }
                    }

                    const schedActive = sc.active !== undefined ? Boolean(sc.active) : true;

                    sanitizedSchedules.push({
                        id: sc.id ? String(sc.id) : `${Date.now()}_sched_${sIdx}_${scIdx}`,
                        label,
                        cron: cronExp,
                        attendanceType: rawType,
                        message,
                        emoji,
                        targetMessageId,
                        maxJitterMinutes,
                        active: schedActive,
                        ...(isOnce ? { type: 'ONCE', runDate } : {})
                    });

                    totalSchedules++;
                });
            }
        }

        sanitizedServers.push({
            id: srv.id ? String(srv.id) : `${Date.now()}_${sIdx}`,
            name,
            channelId: channelIdRaw,
            webhookUrl,
            active,
            schedules: sanitizedSchedules
        });
    });

    const isValid = errors.length === 0;

    return {
        isValid,
        errors,
        warnings,
        sanitized: isValid ? {
            app: 'AttendanceBot',
            version: VERSION,
            globalWebhookUrl: globalWebhook,
            globalToken: globalToken,
            servers: sanitizedServers
        } : null,
        stats: {
            serverCount: sanitizedServers.length,
            scheduleCount: totalSchedules
        }
    };
}

module.exports = {
    validateConfigSchema,
    isValidSnowflake,
    isValidUrl
};
