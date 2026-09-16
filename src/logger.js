function formatTime() {
    return new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
}

const listeners = [];
const history = [];
const MAX_HISTORY = 300;

function record(level, message) {
    const entry = { time: formatTime(), level, message, id: Date.now() + Math.random().toString(36).slice(2, 6) };
    history.push(entry);
    if (history.length > MAX_HISTORY) {
        history.shift();
    }
    listeners.forEach((fn) => {
        try { fn(entry); } catch (e) { /* ignore */ }
    });
    return entry;
}

const logger = {
    addListener: (fn) => listeners.push(fn),
    removeListener: (fn) => {
        const idx = listeners.indexOf(fn);
        if (idx !== -1) listeners.splice(idx, 1);
    },
    getHistory: () => [...history],
    clearHistory: () => { history.length = 0; },
    info: (msg) => {
        const entry = record('INFO', msg);
        console.log(`[${entry.time}] [INFO] ${msg}`);
    },
    warn: (msg) => {
        const entry = record('WARN', msg);
        console.warn(`[${entry.time}] [WARN] ${msg}`);
    },
    error: (msg, err) => {
        const fullMsg = err ? `${msg} ${err.message || err}` : msg;
        const entry = record('ERROR', fullMsg);
        console.error(`[${entry.time}] [ERROR] ${fullMsg}`);
    },
    success: (msg) => {
        const entry = record('SUCCESS', msg);
        console.log(`[${entry.time}] [SUCCESS] ${msg}`);
    },
};

module.exports = logger;
