function formatTime() {
    return new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
}

const logger = {
    info: (msg) => console.log(`[${formatTime()}] [INFO] ${msg}`),
    warn: (msg) => console.warn(`[${formatTime()}] [WARN] ${msg}`),
    error: (msg, err) => console.error(`[${formatTime()}] [ERROR] ${msg}`, err || ''),
    success: (msg) => console.log(`[${formatTime()}] [SUCCESS] ${msg}`),
};

module.exports = logger;
