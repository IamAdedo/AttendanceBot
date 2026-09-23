let currentConfig = { globalToken: '', globalWebhookUrl: '', servers: [] };
let currentStatus = { status: 'STOPPED', user: null, activeJobsCount: 0, stats: {} };
let activeTab = 'servers';
let isStartingOrStopping = false;
let serverSearchQuery = '';
let serverStatusFilter = 'ALL';
let selectedServerIds = new Set();
let pendingImportData = null;
let desktopNotificationsEnabled = localStorage.getItem('attendanceBot_desktop_notifications') === 'true';
let rechartsRoot = null;
let latestDailyData = null;
let currentSessionLogs = [];
let logSearchQuery = '';
let logLevelFilter = 'ALL';
let currentTheme = localStorage.getItem('attendancebot_theme') || 'dark';

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initDailyTargetUI();
    initAutoBackupUI();
    fetchConfig();
    fetchStatus();
    fetchDailyCheckinStats();
    setupLogStream();
    initDesktopNotifications();
    setupKeyboardShortcuts();
    setInterval(fetchStatus, 5000);
});

// --- TAB SWITCHING ---
function switchTab(tabId) {
    activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('border-discord-blurple', 'text-white');
        btn.classList.add('border-transparent', 'text-discord-muted');
    });
    document.querySelectorAll('.tab-content').forEach(sec => sec.classList.add('hidden'));

    const activeBtn = document.getElementById(`tabBtn-${tabId}`);
    const activeSec = document.getElementById(`tab-${tabId}`);
    if (activeBtn) {
        activeBtn.classList.add('border-discord-blurple', 'text-white');
        activeBtn.classList.remove('border-transparent', 'text-discord-muted');
    }
    if (activeSec) {
        activeSec.classList.remove('hidden');
    }

    if (tabId === 'cli') {
        setTimeout(() => {
            const input = document.getElementById('cliTerminalInput');
            if (input) input.focus();
        }, 100);
    }
}

// --- API INTERACTIONS ---
let consecutiveStatusFailures = 0;
let consecutiveConfigFailures = 0;

async function fetchConfig(isRetry = false) {
    try {
        const res = await fetch('/api/config');
        if (!res.ok) {
            consecutiveConfigFailures++;
            return;
        }
        consecutiveConfigFailures = 0;
        currentConfig = await res.json();

        // Populate credentials inputs
        const tokenInput = document.getElementById('inputGlobalToken');
        if (tokenInput && currentConfig.globalToken) {
            tokenInput.value = currentConfig.globalToken;
        }
        const webhookInput = document.getElementById('inputGlobalWebhook');
        if (webhookInput && currentConfig.globalWebhookUrl) {
            webhookInput.value = currentConfig.globalWebhookUrl;
        }

        renderServers();
        updateStats();
        if (typeof performAutoBackup === 'function' && autoBackupEnabled) {
            performAutoBackup(true);
        }
    } catch (err) {
        consecutiveConfigFailures++;
        console.warn('AttendanceBot config temporarily unavailable (retrying):', err && err.message ? err.message : err);
        if (!isRetry && consecutiveConfigFailures <= 3) {
            setTimeout(() => fetchConfig(true), 1500);
        }
    }
}

async function fetchStatus(isRetry = false) {
    try {
        const res = await fetch('/api/status');
        if (!res.ok) {
            consecutiveStatusFailures++;
            return;
        }
        consecutiveStatusFailures = 0;
        currentStatus = await res.json();
        updateDaemonStatusUI();
        updateStats();

        // Refresh server health UI if cards are mounted
        if (currentStatus.serverHealth) {
            renderServers();
        }

        // Update Recharts line chart data if daily stats exist
        if (currentStatus.dailyStats) {
            updateCheckinChart(currentStatus.dailyStats);
        }
    } catch (err) {
        consecutiveStatusFailures++;
        // Transient network blip, container proxy delay, or server restart
        console.warn('AttendanceBot status temporarily unavailable (retrying):', err && err.message ? err.message : err);
        if (!isRetry && consecutiveStatusFailures <= 3) {
            setTimeout(() => fetchStatus(true), 1500);
        }
    }
}

function updateDaemonStatusUI() {
    const dot = document.getElementById('statusIndicatorDot');
    const text = document.getElementById('statusIndicatorText');
    const btn = document.getElementById('toggleDaemonBtn');
    const btnIcon = document.getElementById('toggleDaemonIcon');
    const btnText = document.getElementById('toggleDaemonText');

    if (!dot || !text || !btn) return;

    if (currentStatus.status === 'RUNNING') {
        dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse';
        text.className = 'text-emerald-400 font-bold';
        text.innerText = currentStatus.user ? `Online (${currentStatus.user.tag})` : 'Online';

        btn.className = 'flex items-center space-x-2 px-4 py-1.5 rounded-lg text-xs font-semibold shadow transition duration-150 bg-rose-600 hover:bg-rose-500 text-white cursor-pointer';
        btnIcon.className = 'fa-solid fa-stop';
        btnText.innerText = 'Stop Daemon';
    } else if (currentStatus.status === 'STARTING') {
        dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping';
        text.className = 'text-amber-400 font-bold';
        text.innerText = 'Connecting Gateway...';

        btn.className = 'flex items-center space-x-2 px-4 py-1.5 rounded-lg text-xs font-semibold shadow transition duration-150 bg-gray-600 text-gray-300 cursor-not-allowed';
        btnIcon.className = 'fa-solid fa-spinner fa-spin';
        btnText.innerText = 'Starting...';
    } else if (currentStatus.status === 'ERROR') {
        dot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
        text.className = 'text-rose-400 font-bold';
        text.innerText = 'Error (Check logs)';

        btn.className = 'flex items-center space-x-2 px-4 py-1.5 rounded-lg text-xs font-semibold shadow transition duration-150 bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer';
        btnIcon.className = 'fa-solid fa-play';
        btnText.innerText = 'Retry Start';
    } else {
        dot.className = 'w-2.5 h-2.5 rounded-full bg-gray-400';
        text.className = 'text-gray-300';
        text.innerText = 'Daemon Offline';

        btn.className = 'flex items-center space-x-2 px-4 py-1.5 rounded-lg text-xs font-semibold shadow transition duration-150 bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer';
        btnIcon.className = 'fa-solid fa-play';
        btnText.innerText = 'Start Daemon';
    }
}

function updateStats() {
    // Discord Account
    const statAccount = document.getElementById('statAccount');
    const statAccountSub = document.getElementById('statAccountSub');
    if (statAccount) {
        if (currentStatus.user) {
            statAccount.innerText = currentStatus.user.tag;
            statAccountSub.innerText = `ID: ${currentStatus.user.id || 'Connected'}`;
        } else if (currentConfig.globalToken) {
            statAccount.innerText = 'Token Configured';
            statAccountSub.innerText = 'Ready to launch';
        } else {
            statAccount.innerText = 'Not Set';
            statAccountSub.innerText = 'Token required';
        }
    }

    // Servers
    const statServers = document.getElementById('statServers');
    const statServersSub = document.getElementById('statServersSub');
    const totalServers = (currentConfig.servers || []).length;
    const activeServers = (currentConfig.servers || []).filter(s => s.active).length;
    if (statServers) statServers.innerText = activeServers;
    if (statServersSub) statServersSub.innerText = `${totalServers} total profile(s)`;

    // Schedules
    const statSchedules = document.getElementById('statSchedules');
    const statSchedulesSub = document.getElementById('statSchedulesSub');
    let totalScheds = 0;
    let activeScheds = 0;
    (currentConfig.servers || []).forEach(s => {
        (s.schedules || []).forEach(sc => {
            totalScheds++;
            if (s.active && sc.active) activeScheds++;
        });
    });
    if (statSchedules) statSchedules.innerText = activeScheds;
    if (statSchedulesSub) statSchedulesSub.innerText = `${totalScheds} total schedule(s)`;

    // Webhook
    const statWebhook = document.getElementById('statWebhook');
    const statWebhookSub = document.getElementById('statWebhookSub');
    if (statWebhook) {
        if (currentConfig.globalWebhookUrl) {
            statWebhook.innerText = 'Active';
            statWebhookSub.innerText = 'Webhook configured';
        } else {
            statWebhook.innerText = 'Disabled';
            statWebhookSub.innerText = 'Optional notifications';
        }
    }
}

async function toggleDaemon() {
    if (isStartingOrStopping) return;
    isStartingOrStopping = true;

    try {
        if (currentStatus.status === 'RUNNING') {
            await fetch('/api/daemon/stop', { method: 'POST' });
        } else {
            const res = await fetch('/api/daemon/start', { method: 'POST' });
            const data = await res.json();
            if (!data.success && data.message) {
                alert(`Cannot start daemon: ${data.message}`);
            }
        }
        await fetchStatus();
    } catch (err) {
        alert(`Daemon action failed: ${err.message}`);
    } finally {
        isStartingOrStopping = false;
    }
}

// --- CREDENTIALS MANAGEMENT ---
function toggleTokenVisibility() {
    const input = document.getElementById('inputGlobalToken');
    const icon = document.getElementById('tokenEyeIcon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fa-regular fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fa-regular fa-eye';
    }
}

async function saveCredentialsSettings() {
    const token = document.getElementById('inputGlobalToken').value;
    const webhook = document.getElementById('inputGlobalWebhook').value;

    try {
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                globalToken: token,
                globalWebhookUrl: webhook,
            }),
        });
        const data = await res.json();
        if (data.success) {
            const notice = document.getElementById('credentialsSaveNotice');
            notice.classList.remove('hidden');
            setTimeout(() => notice.classList.add('hidden'), 3500);
            await fetchConfig();
            await fetchStatus();
        } else {
            alert('Failed to save configuration');
        }
    } catch (err) {
        alert(`Error saving credentials: ${err.message}`);
    }
}

async function testGlobalWebhook() {
    const webhook = document.getElementById('inputGlobalWebhook').value;
    if (!webhook || !webhook.trim()) {
        alert('Please enter a Discord Webhook URL first.');
        return;
    }

    try {
        const res = await fetch('/api/test-webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ webhookUrl: webhook }),
        });
        const data = await res.json();
        if (data.success) {
            alert('✅ Webhook test passed! Notification was sent to Discord.');
        } else {
            alert(`❌ Webhook test failed: ${data.message || 'Check URL'}`);
        }
    } catch (err) {
        alert(`Webhook test error: ${err.message}`);
    }
}

function triggerTestWebhookModal() {
    switchTab('credentials');
    testGlobalWebhook();
}

// --- 30-DAY ATTENDANCE CHECK-INS (RECHARTS INTEGRATION) ---
async function fetchDailyCheckinStats() {
    const refreshIcon = document.getElementById('refreshChartIcon');
    if (refreshIcon) refreshIcon.classList.add('fa-spin');

    try {
        const res = await fetch('/api/stats/daily-checkins');
        if (!res.ok) return;
        const statsData = await res.json();
        updateCheckinChart(statsData);
    } catch (err) {
        console.warn('AttendanceBot daily stats temporarily unavailable:', err && err.message ? err.message : err);
    } finally {
        if (refreshIcon) refreshIcon.classList.remove('fa-spin');
    }
}

function refreshCheckinStats() {
    fetchDailyCheckinStats();
}

function updateCheckinChart(statsData) {
    if (!statsData || !Array.isArray(statsData.daily)) return;

    // Update 30-day metric badges in header
    const totalEl = document.getElementById('chartTotalCheckins');
    const successEl = document.getElementById('chartTotalSuccess');
    const failedEl = document.getElementById('chartTotalFailed');
    const rateEl = document.getElementById('chartSuccessRate');
    const avgEl = document.getElementById('chartAvgDaily');
    const peakEl = document.getElementById('chartPeakDay');

    if (statsData.summary) {
        if (totalEl) totalEl.innerText = statsData.summary.totalCheckins ?? '0';
        if (successEl) successEl.innerText = statsData.summary.totalSuccess ?? '0';
        if (failedEl) failedEl.innerText = statsData.summary.totalFailed ?? '0';
        if (rateEl) rateEl.innerText = statsData.summary.successRate ?? '100%';
        if (avgEl) avgEl.innerText = `${statsData.summary.avgDaily ?? '0.0'}/d`;
        if (peakEl) peakEl.innerText = statsData.summary.peakDay ?? 'None';
    }

    renderRechartsCheckins(statsData.daily);
    updateDailyTargetProgress(statsData.daily);
}

function renderRechartsCheckins(dailyData) {
    if (dailyData) latestDailyData = dailyData;
    const container = document.getElementById('rechartsOverviewContainer');
    if (!container) return;

    // Check if React and Recharts are loaded from UMD scripts
    if (!window.React || !window.ReactDOM || !window.Recharts) {
        setTimeout(() => renderRechartsCheckins(dailyData), 250);
        return;
    }

    const isLight = document.documentElement.classList.contains('light');

    const { createElement: h } = window.React;
    const {
        ResponsiveContainer,
        LineChart,
        Line,
        XAxis,
        YAxis,
        CartesianGrid,
        Tooltip,
        Legend
    } = window.Recharts;

    // Custom theme-aware tooltip
    const CustomTooltip = (props) => {
        const { active, payload } = props;
        if (!active || !payload || !payload.length) return null;
        const item = payload[0].payload;
        const tooltipBg = isLight
            ? 'bg-white border border-slate-200 p-3 rounded-xl shadow-xl text-xs space-y-1.5 font-sans min-w-[170px]'
            : 'bg-[#1e1f22] border border-[#383a40] p-3 rounded-xl shadow-2xl text-xs space-y-1.5 font-sans min-w-[170px]';
        const titleClass = isLight ? 'font-bold text-slate-900' : 'font-bold text-white';
        const dividerClass = isLight ? 'border-b border-slate-200 pb-1.5' : 'border-b border-[#383a40]/70 pb-1.5';

        const successColor = isLight ? 'text-emerald-700' : 'text-emerald-400';
        const failedColor = isLight ? 'text-rose-700' : 'text-rose-400';
        const totalColor = isLight ? 'text-indigo-600' : 'text-indigo-400';

        return h('div', { className: tooltipBg }, [
            h('div', { key: 'h', className: `flex items-center justify-between gap-3 ${dividerClass}` }, [
                h('span', { key: 'hl', className: titleClass }, `${item.label} (${item.weekday})`),
                h('span', { key: 'ht', className: `${totalColor} font-mono font-bold` }, `${item.checkins} run${item.checkins === 1 ? '' : 's'}`)
            ]),
            h('div', { key: 's', className: `flex items-center justify-between ${successColor} font-medium` }, [
                h('span', { key: 'sl', className: 'flex items-center gap-1.5' }, [
                    h('span', { key: 'dot', className: 'w-2 h-2 rounded-full bg-emerald-500' }),
                    'Successful'
                ]),
                h('span', { key: 'sv', className: 'font-mono font-bold' }, item.success)
            ]),
            h('div', { key: 'f', className: `flex items-center justify-between ${failedColor} font-medium` }, [
                h('span', { key: 'fl', className: 'flex items-center gap-1.5' }, [
                    h('span', { key: 'fdot', className: 'w-2 h-2 rounded-full bg-rose-500' }),
                    'Failed'
                ]),
                h('span', { key: 'fv', className: 'font-mono font-bold' }, item.failed)
            ]),
            h('div', { key: 'r', className: `flex items-center justify-between text-[11px] pt-1 border-t ${isLight ? 'border-slate-100 text-slate-500' : 'border-white/5 text-gray-400'}` }, [
                h('span', { key: 'rl' }, 'Reliability:'),
                h('span', { key: 'rv', className: 'font-mono font-bold text-discord-text' }, item.checkins > 0 ? `${((item.success / item.checkins) * 100).toFixed(0)}%` : '100%')
            ])
        ]);
    };

    const chartComponent = h(ResponsiveContainer, { width: '100%', height: '100%' },
        h(LineChart, {
            data: dailyData,
            margin: { top: 12, right: 18, left: -22, bottom: 4 }
        }, [
            h(CartesianGrid, {
                key: 'grid',
                strokeDasharray: '3 3',
                stroke: isLight ? '#e2e8f0' : '#383a40',
                strokeOpacity: isLight ? 0.9 : 0.5
            }),
            h(XAxis, {
                key: 'xaxis',
                dataKey: 'label',
                stroke: isLight ? '#64748b' : '#949ba4',
                fontSize: 11,
                tickLine: false,
                interval: 2
            }),
            h(YAxis, {
                key: 'yaxis',
                stroke: isLight ? '#64748b' : '#949ba4',
                fontSize: 11,
                tickLine: false,
                allowDecimals: false
            }),
            h(Tooltip, {
                key: 'tooltip',
                content: h(CustomTooltip)
            }),
            h(Legend, {
                key: 'legend',
                verticalAlign: 'top',
                height: 28,
                wrapperStyle: { fontSize: '11px', color: isLight ? '#334155' : '#dbdee1' }
            }),
            h(Line, {
                key: 'lineSuccess',
                type: 'monotone',
                dataKey: 'success',
                name: 'Successful Attempts',
                stroke: isLight ? '#059669' : '#57F287',
                strokeWidth: 2.5,
                dot: { r: 2.5, fill: isLight ? '#059669' : '#57F287', strokeWidth: 0 },
                activeDot: { r: 5, fill: isLight ? '#059669' : '#57F287', stroke: '#ffffff', strokeWidth: 2 }
            }),
            h(Line, {
                key: 'lineFailed',
                type: 'monotone',
                dataKey: 'failed',
                name: 'Failed Attempts',
                stroke: isLight ? '#dc2626' : '#ED4245',
                strokeWidth: 2.5,
                dot: { r: 2.5, fill: isLight ? '#dc2626' : '#ED4245', strokeWidth: 0 },
                activeDot: { r: 5, fill: isLight ? '#dc2626' : '#ED4245', stroke: '#ffffff', strokeWidth: 2 }
            }),
            h(Line, {
                key: 'lineTotal',
                type: 'monotone',
                dataKey: 'checkins',
                name: 'Total Dispatches',
                stroke: isLight ? '#6366f1' : '#5865F2',
                strokeWidth: 1.5,
                strokeDasharray: '4 4',
                dot: false,
                activeDot: { r: 4.5, fill: isLight ? '#6366f1' : '#5865F2' }
            })
        ])
    );

    try {
        if (!rechartsRoot) {
            container.innerHTML = '';
            if (window.ReactDOM.createRoot) {
                rechartsRoot = window.ReactDOM.createRoot(container);
                rechartsRoot.render(chartComponent);
            } else if (window.ReactDOM.render) {
                window.ReactDOM.render(chartComponent, container);
            }
        } else {
            rechartsRoot.render(chartComponent);
        }
    } catch (err) {
        console.warn('Notice mounting Recharts element:', err && err.message ? err.message : err);
    }
}

// --- DAILY TARGET FEATURE ---
let dailyTargetGoal = parseInt(localStorage.getItem('attendancebot_daily_target') || '10', 10);
if (isNaN(dailyTargetGoal) || dailyTargetGoal < 1) dailyTargetGoal = 10;

function initDailyTargetUI() {
    const input = document.getElementById('dailyTargetInput');
    if (input) input.value = dailyTargetGoal;
    const goalEl = document.getElementById('dailyTargetGoal');
    if (goalEl) goalEl.innerText = dailyTargetGoal;
}

function handleDailyTargetChange(val) {
    let parsed = parseInt(val, 10);
    if (isNaN(parsed) || parsed < 1) parsed = 1;
    if (parsed > 500) parsed = 500;
    dailyTargetGoal = parsed;
    try {
        localStorage.setItem('attendancebot_daily_target', String(dailyTargetGoal));
    } catch (e) {}
    initDailyTargetUI();
    if (latestDailyData) {
        updateDailyTargetProgress(latestDailyData);
    }
    showNotificationToast(`Daily target set to ${dailyTargetGoal} check-ins`, 'success');
}

function promptCustomDailyTarget() {
    const current = dailyTargetGoal;
    const answer = prompt('Enter your daily attendance check-in target (1 - 500):', current);
    if (answer !== null) {
        handleDailyTargetChange(answer);
    }
}

function updateDailyTargetProgress(dailyList) {
    if (!Array.isArray(dailyList) || dailyList.length === 0) return;
    const today = dailyList[dailyList.length - 1];
    const checkins = today ? (today.checkins || 0) : 0;
    const success = today ? (today.success || 0) : 0;
    const dateLabel = today ? today.label : 'Today';

    const currentEl = document.getElementById('dailyTargetCurrent');
    const goalEl = document.getElementById('dailyTargetGoal');
    const percentEl = document.getElementById('dailyTargetPercent');
    const barEl = document.getElementById('dailyTargetProgressBar');
    const badgeEl = document.getElementById('dailyTargetBadge');
    const badgeTextEl = document.getElementById('dailyTargetBadgeText');
    const remainingEl = document.getElementById('dailyTargetRemainingText');
    const dateTextEl = document.getElementById('dailyTargetDateText');

    if (currentEl) currentEl.innerText = checkins;
    if (goalEl) goalEl.innerText = dailyTargetGoal;
    if (dateTextEl) dateTextEl.innerText = `Today: ${dateLabel}`;

    const percentage = Math.round((checkins / dailyTargetGoal) * 100);
    const clampedWidth = Math.min(100, percentage);

    if (percentEl) percentEl.innerText = `${percentage}%`;
    if (barEl) {
        barEl.style.width = `${clampedWidth}%`;
        if (checkins >= dailyTargetGoal) {
            barEl.className = 'h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-400 transition-all duration-500 ease-out shadow-[0_0_12px_rgba(16,185,129,0.35)]';
        } else {
            barEl.className = 'h-full rounded-full bg-gradient-to-r from-discord-blurple to-indigo-500 transition-all duration-500 ease-out';
        }
    }

    if (checkins >= dailyTargetGoal) {
        if (badgeEl) {
            badgeEl.className = 'text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1.5';
        }
        if (badgeTextEl) badgeTextEl.innerText = 'Goal Achieved! 🎉';
        if (remainingEl) remainingEl.innerHTML = `<span class="text-emerald-400 font-semibold">Goal accomplished today!</span> (${checkins} check-ins performed with ${success} successful dispatches).`;
    } else {
        const needed = dailyTargetGoal - checkins;
        if (badgeEl) {
            badgeEl.className = 'text-xs px-2.5 py-0.5 rounded-full font-bold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 inline-flex items-center gap-1.5';
        }
        if (badgeTextEl) badgeTextEl.innerText = 'In Progress';
        if (remainingEl) remainingEl.innerText = `${needed} more check-in${needed === 1 ? '' : 's'} needed to reach today's target (${success} successful so far).`;
    }
}

// --- LOCAL AUTO-BACKUP & RESTORE ---
const BACKUP_STORAGE_KEY = 'attendancebot_local_backup';
const AUTOBACKUP_ENABLED_KEY = 'attendancebot_autobackup_enabled';
let autoBackupEnabled = localStorage.getItem(AUTOBACKUP_ENABLED_KEY) !== 'false'; // default true

function initAutoBackupUI() {
    const toggle = document.getElementById('autoBackupToggle');
    if (toggle) toggle.checked = autoBackupEnabled;
    updateAutoBackupStatusUI();

    // Schedule periodic backup every 60 seconds
    setInterval(() => {
        if (autoBackupEnabled) {
            performAutoBackup(true);
        }
    }, 60000);
}

function handleAutoBackupToggle(isChecked) {
    autoBackupEnabled = Boolean(isChecked);
    try {
        localStorage.setItem(AUTOBACKUP_ENABLED_KEY, String(autoBackupEnabled));
    } catch (e) {}
    updateAutoBackupStatusUI();
    if (autoBackupEnabled) {
        performAutoBackup(false);
        showNotificationToast('Local Auto-Backup enabled (every 60s)', 'success');
    } else {
        showNotificationToast('Local Auto-Backup paused', 'info');
    }
}

function updateAutoBackupStatusUI() {
    const badge = document.getElementById('autoBackupStatusBadge');
    const lastTimeEl = document.getElementById('lastAutoBackupTime');
    const countEl = document.getElementById('backedUpServerCount');

    if (badge) {
        if (autoBackupEnabled) {
            badge.className = 'text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1.5';
            badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span><span>Active (Auto-save every 60s)</span>';
        } else {
            badge.className = 'text-xs px-2.5 py-0.5 rounded-full font-semibold bg-zinc-700/25 text-zinc-400 border border-zinc-600/30 inline-flex items-center gap-1.5';
            badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-zinc-500"></span><span>Auto-Backup Paused</span>';
        }
    }

    const savedRaw = localStorage.getItem(BACKUP_STORAGE_KEY);
    if (savedRaw) {
        try {
            const saved = JSON.parse(savedRaw);
            if (lastTimeEl && saved.timestamp) {
                const dt = new Date(saved.timestamp);
                lastTimeEl.innerText = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' (' + dt.toLocaleDateString() + ')';
            }
            if (countEl && saved.serverCount !== undefined) {
                countEl.innerText = `${saved.serverCount} server(s) / ${saved.scheduleCount || 0} schedule(s)`;
            }
        } catch (e) {}
    } else {
        if (lastTimeEl) lastTimeEl.innerText = 'Not saved yet';
        if (countEl) countEl.innerText = '0 servers / 0 schedules';
    }
}

function performAutoBackup(silent = false) {
    if (!currentConfig || !Array.isArray(currentConfig.servers)) return;

    let schedCount = 0;
    currentConfig.servers.forEach(s => {
        if (Array.isArray(s.schedules)) schedCount += s.schedules.length;
    });

    const snapshot = {
        app: 'AttendanceBot',
        timestamp: new Date().toISOString(),
        serverCount: currentConfig.servers.length,
        scheduleCount: schedCount,
        config: {
            globalToken: currentConfig.globalToken || '',
            globalWebhookUrl: currentConfig.globalWebhookUrl || '',
            servers: currentConfig.servers || []
        }
    };

    try {
        localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(snapshot));
        updateAutoBackupStatusUI();
        if (!silent) {
            showNotificationToast(`Auto-backup saved (${currentConfig.servers.length} servers snapshot)`, 'success');
        }
    } catch (err) {
        console.warn('Failed to save auto-backup to localStorage:', err);
    }
}

function triggerManualBackup() {
    performAutoBackup(false);
    showNotificationToast('Configuration snapshot backed up to localStorage!', 'success');
}

function downloadConfigBackupJson() {
    if (!currentConfig) return;

    let totalSchedules = 0;
    (currentConfig.servers || []).forEach(s => {
        if (Array.isArray(s.schedules)) totalSchedules += s.schedules.length;
    });

    const exportData = {
        app: 'AttendanceBot',
        version: '3.0.0',
        exportedAt: new Date().toISOString(),
        serverCount: (currentConfig.servers || []).length,
        scheduleCount: totalSchedules,
        globalWebhookUrl: currentConfig.globalWebhookUrl || '',
        servers: currentConfig.servers || []
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStamp = new Date().toISOString().slice(0, 10);
    a.download = `attendancebot-config-backup-${dateStamp}.json`;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 250);

    showNotificationToast('Configuration downloaded as JSON file.', 'success');
}

async function restoreFromLocalBackup() {
    const raw = localStorage.getItem(BACKUP_STORAGE_KEY);
    if (!raw) {
        alert('No local auto-backup snapshot found in browser storage.');
        return;
    }

    let backup;
    try {
        backup = JSON.parse(raw);
    } catch (e) {
        alert('Local backup data is corrupted.');
        return;
    }

    const dateStr = backup.timestamp ? new Date(backup.timestamp).toLocaleString() : 'Unknown date';
    const serverCount = backup.serverCount || (backup.config && backup.config.servers ? backup.config.servers.length : 0);

    const confirmed = confirm(`Restore configuration from local auto-backup snapshot?\n\n• Snapshot Time: ${dateStr}\n• Included Servers: ${serverCount}\n\nThis will restore your servers and schedules into the current session.`);
    if (!confirmed) return;

    try {
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(backup.config)
        });
        const data = await res.json();
        if (data.success) {
            await fetchConfig();
            await fetchStatus();
            showNotificationToast(`Restored ${serverCount} servers from local backup!`, 'success');
        } else {
            alert(`Failed to restore backup: ${data.error || 'Server error'}`);
        }
    } catch (err) {
        alert(`Error restoring backup: ${err.message}`);
    }
}

// --- BROWSER NOTIFICATIONS & LOCAL SYSTEM ALERTS ---
function initDesktopNotifications() {
    updateNotificationButtonUI();
}

function updateNotificationButtonUI() {
    const btn = document.getElementById('desktopNotificationBtn');
    const icon = document.getElementById('desktopNotificationIcon');
    const text = document.getElementById('desktopNotificationText');
    const badge = document.getElementById('desktopNotificationBadge');
    if (!btn || !icon) return;

    if (!('Notification' in window)) {
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        btn.title = 'Desktop notifications are not supported by this browser';
        if (text) text.innerText = 'Alerts Unsupported';
        if (badge) badge.className = 'w-2 h-2 rounded-full bg-gray-500';
        return;
    }

    if (Notification.permission === 'granted') {
        if (desktopNotificationsEnabled) {
            btn.className = 'flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 transition cursor-pointer';
            icon.className = 'fa-solid fa-bell text-emerald-400';
            if (text) text.innerText = 'Alerts Active';
            if (badge) badge.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
            btn.title = 'Desktop system alerts enabled for task completions. Click to pause.';
        } else {
            btn.className = 'flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-discord-card hover:bg-discord-border text-discord-muted border border-discord-border transition cursor-pointer';
            icon.className = 'fa-regular fa-bell-slash text-gray-400';
            if (text) text.innerText = 'Alerts Paused';
            if (badge) badge.className = 'w-2 h-2 rounded-full bg-amber-400';
            btn.title = 'Desktop alerts paused. Click to resume notifications.';
        }
    } else if (Notification.permission === 'denied') {
        btn.className = 'flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition cursor-pointer';
        icon.className = 'fa-solid fa-bell-slash text-rose-400';
        if (text) text.innerText = 'Alerts Blocked';
        if (badge) badge.className = 'w-2 h-2 rounded-full bg-rose-500';
        btn.title = 'Notifications blocked in browser settings. Please permit notifications in your browser.';
    } else {
        // 'default' (not requested yet)
        btn.className = 'flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-discord-card hover:bg-discord-border text-discord-text border border-discord-border transition cursor-pointer';
        icon.className = 'fa-solid fa-bell text-discord-blurple';
        if (text) text.innerText = 'Enable Alerts';
        if (badge) badge.className = 'w-2 h-2 rounded-full bg-indigo-400';
        btn.title = 'Request browser notification permission to get system alerts on successful tasks';
    }
}

async function toggleDesktopNotifications() {
    if (!('Notification' in window)) {
        alert('Desktop notifications are not supported in this browser.');
        return;
    }

    if (Notification.permission === 'default') {
        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                desktopNotificationsEnabled = true;
                localStorage.setItem('attendanceBot_desktop_notifications', 'true');
                triggerLocalSystemAlert({
                    title: '⚡ AttendanceBot Alerts Active',
                    body: 'You will receive local desktop alerts whenever an attendance task completes successfully!'
                });
                showNotificationToast('Desktop notifications enabled successfully!', 'success');
            } else {
                desktopNotificationsEnabled = false;
                localStorage.setItem('attendanceBot_desktop_notifications', 'false');
                showNotificationToast('Notification permission was not granted.', 'warning');
            }
        } catch (err) {
            console.warn('Notice requesting notification permission:', err && err.message ? err.message : err);
        }
    } else if (Notification.permission === 'granted') {
        desktopNotificationsEnabled = !desktopNotificationsEnabled;
        localStorage.setItem('attendanceBot_desktop_notifications', desktopNotificationsEnabled ? 'true' : 'false');
        if (desktopNotificationsEnabled) {
            triggerLocalSystemAlert({
                title: '⚡ AttendanceBot Alerts Resumed',
                body: 'System notifications are active for scheduled attendance tasks.'
            });
            showNotificationToast('Desktop alerts enabled.', 'success');
        } else {
            showNotificationToast('Desktop alerts paused.', 'info');
        }
    } else if (Notification.permission === 'denied') {
        alert('Notification permission is blocked in your browser settings. To enable local system alerts, please permit notifications for this origin in your browser settings or URL bar lock icon.');
    }

    updateNotificationButtonUI();
}

function triggerLocalSystemAlert({ title, body, icon }) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!desktopNotificationsEnabled) return;

    try {
        const notif = new Notification(title || '⚡ Attendance Completed', {
            body: body || 'Attendance task executed successfully.',
            tag: 'attendancebot-exec-' + Date.now(),
            icon: icon || 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/26a1.png',
            silent: false
        });

        setTimeout(() => {
            try { notif.close(); } catch (e) {}
        }, 7000);
    } catch (e) {
        console.warn('Could not dispatch local system notification:', e);
    }
}

// --- GLOBAL KEYBOARD SHORTCUTS ---
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const isModifier = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        const activeElem = document.activeElement;
        const isTyping = activeElem && (
            activeElem.tagName === 'INPUT' ||
            activeElem.tagName === 'TEXTAREA' ||
            activeElem.isContentEditable
        );

        // Escape: Close any open modal dialog
        if (e.key === 'Escape') {
            closeAllOpenModals();
            return;
        }

        // Help Modal: ? or Ctrl+/ (when not actively editing text)
        if ((key === '?' || (isModifier && (e.key === '/' || e.key === '?'))) && !isTyping) {
            e.preventDefault();
            toggleShortcutsModal();
            return;
        }

        // Ctrl+S / Cmd+S: Save Settings or Save Current Open Modal
        if (isModifier && key === 's') {
            e.preventDefault();
            handleGlobalSaveShortcut();
            return;
        }

        // Ctrl+N / Cmd+N or Alt+N: Add New Server Profile
        if ((isModifier && key === 'n') || (e.altKey && key === 'n')) {
            e.preventDefault();
            openAddServerModal();
            return;
        }

        // Ctrl+B: Toggle Daemon Background Worker
        if (isModifier && key === 'b') {
            e.preventDefault();
            toggleDaemon();
            return;
        }

        // Alt+T or Ctrl+Shift+T: Toggle Dark / Light Theme
        if ((e.altKey && key === 't') || (isModifier && e.shiftKey && key === 't')) {
            e.preventDefault();
            toggleTheme();
            return;
        }

        // Ctrl+F or / (when not typing): Focus Server Search Input
        if ((isModifier && key === 'f') || (e.key === '/' && !isTyping)) {
            e.preventDefault();
            switchTab('servers');
            const searchInput = document.getElementById('serverSearchInput');
            if (searchInput) {
                searchInput.focus();
                searchInput.select();
            }
            return;
        }

        // Ctrl + 1..4: Quick Switch Tabs
        if (isModifier && ['1', '2', '3', '4'].includes(e.key)) {
            e.preventDefault();
            const tabMap = { '1': 'servers', '2': 'credentials', '3': 'logs', '4': 'guide' };
            switchTab(tabMap[e.key]);
            return;
        }
    });
}

function handleGlobalSaveShortcut() {
    // 1. If Server Modal is open, submit it
    const serverModal = document.getElementById('serverModal');
    if (serverModal && !serverModal.classList.contains('hidden')) {
        saveServer();
        return;
    }

    // 2. If Schedule Modal is open, submit it
    const scheduleModal = document.getElementById('scheduleModal');
    if (scheduleModal && !scheduleModal.classList.contains('hidden')) {
        saveSchedule();
        return;
    }

    // 3. If Import Modal is open, confirm import
    const importModal = document.getElementById('importModal');
    if (importModal && !importModal.classList.contains('hidden')) {
        confirmImportConfig();
        return;
    }

    // 4. If on Credentials Tab, save credentials
    if (activeTab === 'credentials') {
        saveCredentials();
        return;
    }

    // Default feedback
    showNotificationToast('Settings are saved and synced.', 'info');
}

function closeAllOpenModals() {
    closeServerModal();
    closeScheduleModal();
    closeImportModal();
    closeShortcutsModal();
    closeStatusLegendModal();
    const testModal = document.getElementById('testWebhookModal');
    if (testModal) testModal.classList.add('hidden');
}

function openStatusLegendModal() {
    const modal = document.getElementById('statusLegendModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function closeStatusLegendModal() {
    const modal = document.getElementById('statusLegendModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function toggleStatusLegendModal() {
    const modal = document.getElementById('statusLegendModal');
    if (!modal) return;
    if (modal.classList.contains('hidden')) {
        openStatusLegendModal();
    } else {
        closeStatusLegendModal();
    }
}

function openShortcutsModal() {
    const modal = document.getElementById('shortcutsModal');
    if (modal) modal.classList.remove('hidden');
}

function closeShortcutsModal() {
    const modal = document.getElementById('shortcutsModal');
    if (modal) modal.classList.add('hidden');
}

function toggleShortcutsModal() {
    const modal = document.getElementById('shortcutsModal');
    if (!modal) return;
    if (modal.classList.contains('hidden')) {
        openShortcutsModal();
    } else {
        closeShortcutsModal();
    }
}

function showNotificationToast(message, type = 'info') {
    const existing = document.getElementById('appGlobalToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'appGlobalToast';
    let bg = 'bg-discord-card border-discord-border text-white';
    let icon = 'fa-solid fa-circle-info text-discord-blurple';
    if (type === 'success') {
        bg = 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200';
        icon = 'fa-solid fa-circle-check text-emerald-400';
    } else if (type === 'warning') {
        bg = 'bg-amber-950/90 border-amber-500/40 text-amber-200';
        icon = 'fa-solid fa-triangle-exclamation text-amber-400';
    }

    toast.className = `fixed bottom-5 right-5 z-50 flex items-center space-x-2.5 px-4 py-2.5 rounded-xl border ${bg} shadow-2xl text-xs backdrop-blur transition-all duration-300 transform translate-y-0 opacity-100`;
    toast.innerHTML = `<i class="${icon}"></i><span>${escapeHtml(message)}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 350);
    }, 3200);
}

// --- SCHEDULE OVERLAP & CONFLICT DETECTION (< 5-MIN WINDOW) ---
function parseCronDaysAndMinutes(cronStr, sched) {
    if (!cronStr) return null;
    const parts = cronStr.trim().split(/\s+/);
    if (parts.length < 5) return null;

    const minutePart = parts[0];
    const hourPart = parts[1];
    const dowPart = parts[4];

    // parse hours
    let hours = [];
    if (hourPart === '*') {
        hours = Array.from({ length: 24 }, (_, i) => i);
    } else if (hourPart.includes(',')) {
        hours = hourPart.split(',').map(Number).filter(n => !isNaN(n));
    } else {
        const h = parseInt(hourPart, 10);
        if (!isNaN(h)) hours = [h];
    }

    // parse minutes
    let minutes = [];
    if (minutePart === '*') {
        minutes = [0];
    } else if (minutePart.includes(',')) {
        minutes = minutePart.split(',').map(Number).filter(n => !isNaN(n));
    } else {
        const m = parseInt(minutePart, 10);
        if (!isNaN(m)) minutes = [m];
    }

    if (hours.length === 0 || minutes.length === 0) return null;

    // Days of week: 0-6 (0=Sun, 1=Mon, ..., 6=Sat)
    const daysOfWeek = new Set();
    if (dowPart === '*') {
        [0, 1, 2, 3, 4, 5, 6].forEach(d => daysOfWeek.add(d));
    } else if (dowPart === '1-5') {
        [1, 2, 3, 4, 5].forEach(d => daysOfWeek.add(d));
    } else if (dowPart === '0,6' || dowPart === '6,0') {
        [0, 6].forEach(d => daysOfWeek.add(d));
    } else if (dowPart.includes(',')) {
        dowPart.split(',').forEach(d => {
            const num = parseInt(d, 10);
            if (!isNaN(num)) daysOfWeek.add(num % 7);
        });
    } else if (dowPart.includes('-')) {
        const [start, end] = dowPart.split('-').map(Number);
        if (!isNaN(start) && !isNaN(end)) {
            for (let i = start; i <= end; i++) daysOfWeek.add(i % 7);
        }
    } else {
        const d = parseInt(dowPart, 10);
        if (!isNaN(d)) daysOfWeek.add(d % 7);
    }

    // Handle one-time schedule
    const isOnce = sched && sched.type === 'ONCE';
    let onceDate = null;
    let onceDateStr = null;
    if (isOnce && sched.runDate) {
        onceDate = new Date(sched.runDate);
        if (!isNaN(onceDate.getTime())) {
            daysOfWeek.clear();
            daysOfWeek.add(onceDate.getDay());
            onceDateStr = sched.runDate;
        }
    }

    const timesInDay = [];
    hours.forEach(h => {
        minutes.forEach(m => {
            timesInDay.push(h * 60 + m);
        });
    });

    return {
        hours,
        minutes,
        daysOfWeek,
        timesInDay,
        isOnce,
        onceDateStr
    };
}

function formatMinutesToTime(totalMinutes) {
    const hours24 = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    const ampm = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 || 12;
    const padMin = String(minutes).padStart(2, '0');
    return `${String(hours12).padStart(2, '0')}:${padMin} ${ampm}`;
}

function checkSchedulesConflict(schedA, schedB) {
    const parsedA = parseCronDaysAndMinutes(schedA.cron, schedA);
    const parsedB = parseCronDaysAndMinutes(schedB.cron, schedB);
    if (!parsedA || !parsedB) return null;

    // If both are one-time, they must be targeting the same date
    if (parsedA.isOnce && parsedB.isOnce) {
        if (parsedA.onceDateStr && parsedB.onceDateStr && parsedA.onceDateStr !== parsedB.onceDateStr) {
            return null;
        }
    }

    // Check day-of-week overlap
    let hasOverlappingDay = false;
    for (const day of parsedA.daysOfWeek) {
        if (parsedB.daysOfWeek.has(day)) {
            hasOverlappingDay = true;
            break;
        }
    }
    if (!hasOverlappingDay) return null;

    // Check closest circular time difference (in minutes within 24h)
    let minDiff = Infinity;
    let bestPair = null;

    for (const tA of parsedA.timesInDay) {
        for (const tB of parsedB.timesInDay) {
            const rawDiff = Math.abs(tA - tB);
            const circularDiff = Math.min(rawDiff, 1440 - rawDiff);
            if (circularDiff < minDiff) {
                minDiff = circularDiff;
                bestPair = { tA, tB };
            }
        }
    }

    // Warning triggers if within 5 minutes of each other
    if (minDiff <= 5 && bestPair) {
        return {
            schedA,
            schedB,
            diffMinutes: minDiff,
            timeAStr: formatMinutesToTime(bestPair.tA),
            timeBStr: formatMinutesToTime(bestPair.tB)
        };
    }
    return null;
}

function analyzeServerScheduleConflicts(server) {
    const schedules = server.schedules || [];
    if (schedules.length < 2) {
        return { hasConflict: false, conflicts: [], conflictingScheduleIds: new Set() };
    }

    const conflicts = [];
    const conflictingScheduleIds = new Set();

    for (let i = 0; i < schedules.length; i++) {
        for (let j = i + 1; j < schedules.length; j++) {
            const schedA = schedules[i];
            const schedB = schedules[j];
            const conflict = checkSchedulesConflict(schedA, schedB);
            if (conflict) {
                conflicts.push(conflict);
                conflictingScheduleIds.add(String(schedA.id));
                conflictingScheduleIds.add(String(schedB.id));
            }
        }
    }

    return {
        hasConflict: conflicts.length > 0,
        conflicts,
        conflictingScheduleIds
    };
}

// --- SEARCH & STATUS FILTER LOGIC ---
function handleServerSearch(query) {
    serverSearchQuery = (query || '').trim();
    const clearBtn = document.getElementById('clearSearchBtn');
    if (clearBtn) {
        if (serverSearchQuery.length > 0) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }
    }
    renderServers();
}

function clearServerSearch() {
    serverSearchQuery = '';
    const input = document.getElementById('serverSearchInput');
    if (input) input.value = '';
    const clearBtn = document.getElementById('clearSearchBtn');
    if (clearBtn) clearBtn.classList.add('hidden');
    renderServers();
}

function handleServerStatusFilter(val) {
    serverStatusFilter = val || 'ALL';
    renderServers();
}

function getFilteredServers() {
    const allServers = currentConfig.servers || [];
    const q = (serverSearchQuery || '').trim().toLowerCase();

    return allServers.filter(server => {
        // Status filter matching
        if (serverStatusFilter !== 'ALL') {
            const serverHealth = (currentStatus.serverHealth && currentStatus.serverHealth[server.id]) || null;
            let health = 'RUNNING';
            if (!server.active) {
                health = 'DISABLED';
            } else if (serverHealth && serverHealth.health === 'FAILED') {
                health = 'FAILED';
            } else if (serverHealth && serverHealth.health) {
                health = serverHealth.health;
            }
            if (health !== serverStatusFilter) return false;
        }

        // Search query matching
        if (!q) return true;
        const nameMatch = (server.name || '').toLowerCase().includes(q);
        const channelMatch = (server.channelId || '').toLowerCase().includes(q);
        return nameMatch || channelMatch;
    });
}

// --- BULK SELECTION & ACTIONS LOGIC ---
function toggleServerSelection(serverId, isChecked) {
    const idStr = String(serverId);
    if (isChecked) {
        selectedServerIds.add(idStr);
    } else {
        selectedServerIds.delete(idStr);
    }
    updateBulkSelectionUI();
}

function toggleSelectAllServers(isChecked) {
    const visibleServers = getFilteredServers();
    if (isChecked) {
        visibleServers.forEach(s => selectedServerIds.add(String(s.id)));
    } else {
        visibleServers.forEach(s => selectedServerIds.delete(String(s.id)));
    }
    renderServers();
    updateBulkSelectionUI();
}

function clearServerSelection() {
    selectedServerIds.clear();
    renderServers();
    updateBulkSelectionUI();
}

function updateBulkSelectionUI() {
    const visibleServers = getFilteredServers();
    const selectAllCheckbox = document.getElementById('selectAllServersCheckbox');
    const bulkActionButtons = document.getElementById('bulkActionButtons');
    const bulkSelectedBadge = document.getElementById('bulkSelectedBadge');
    const count = selectedServerIds.size;

    if (selectAllCheckbox) {
        if (visibleServers.length > 0 && visibleServers.every(s => selectedServerIds.has(String(s.id)))) {
            selectAllCheckbox.checked = true;
            selectAllCheckbox.indeterminate = false;
        } else if (visibleServers.some(s => selectedServerIds.has(String(s.id)))) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = true;
        } else {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        }
    }

    if (bulkActionButtons && bulkSelectedBadge) {
        if (count > 0) {
            bulkActionButtons.classList.remove('hidden');
            bulkActionButtons.classList.add('flex');
            bulkSelectedBadge.classList.remove('hidden');
            bulkSelectedBadge.innerText = `${count} selected`;
        } else {
            bulkActionButtons.classList.add('hidden');
            bulkActionButtons.classList.remove('flex');
            bulkSelectedBadge.classList.add('hidden');
        }
    }
}

async function bulkSetServersActive(active) {
    if (selectedServerIds.size === 0) {
        showNotificationToast('No servers selected.', 'warning');
        return;
    }
    const serverIds = Array.from(selectedServerIds);
    const action = active ? 'enable' : 'disable';

    try {
        const res = await fetch('/api/servers/bulk-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, serverIds })
        });
        const data = await res.json();
        if (data.success) {
            showNotificationToast(`Bulk ${active ? 'enabled' : 'disabled'} ${data.count} server(s).`, 'success');
            await fetchConfig();
            await fetchStatus();
            clearServerSelection();
        } else {
            alert(`Bulk action failed: ${data.error || 'Unknown error'}`);
        }
    } catch (err) {
        alert(`Error executing bulk action: ${err.message}`);
    }
}

async function bulkDeleteSelectedServers() {
    if (selectedServerIds.size === 0) {
        showNotificationToast('No servers selected.', 'warning');
        return;
    }
    const count = selectedServerIds.size;
    const confirmed = confirm(`Are you sure you want to permanently delete the ${count} selected server profile(s)?\n\nAll associated attendance schedules will also be removed. This cannot be undone.`);
    if (!confirmed) return;

    const serverIds = Array.from(selectedServerIds);
    try {
        const res = await fetch('/api/servers/bulk-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', serverIds })
        });
        const data = await res.json();
        if (data.success) {
            showNotificationToast(`Successfully deleted ${data.count} server profile(s).`, 'success');
            clearServerSelection();
            await fetchConfig();
            await fetchStatus();
        } else {
            alert(`Bulk delete failed: ${data.error || 'Unknown error'}`);
        }
    } catch (err) {
        alert(`Error executing bulk delete: ${err.message}`);
    }
}

// --- BULK TOGGLE MONITORING STATUS ---
async function toggleAllServers(active) {
    const allServers = currentConfig.servers || [];
    if (allServers.length === 0) {
        alert('No configured servers found to toggle.');
        return;
    }

    const actionText = active ? 'enable' : 'pause';
    const serverCount = allServers.length;

    try {
        const res = await fetch('/api/servers/toggle-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: Boolean(active) })
        });

        const data = await res.json();
        if (data.success) {
            currentConfig.servers.forEach(s => {
                s.active = Boolean(active);
            });
            renderServers();
            updateStats();
        } else {
            alert(`Failed to update servers: ${data.error || 'Unknown error'}`);
        }
    } catch (err) {
        alert(`Error toggling servers: ${err.message}`);
    }
}

// --- EXPORT & IMPORT CONFIGURATION ---
function exportConfigJSON() {
    const servers = currentConfig.servers || [];
    if (servers.length === 0) {
        alert('There are no server profiles configured to export.');
        return;
    }

    const exportData = {
        app: 'AttendanceBot',
        version: '3.0.0',
        exportedAt: new Date().toISOString(),
        globalWebhookUrl: currentConfig.globalWebhookUrl || '',
        servers: servers
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `attendancebot-servers-config-${dateStamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function triggerImportConfig() {
    const input = document.getElementById('importFileInput');
    if (input) {
        input.value = '';
        input.click();
    }
}

function handleConfigFileSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            let importedServers = [];
            let globalWebhook = '';

            if (Array.isArray(parsed)) {
                importedServers = parsed;
            } else if (parsed && typeof parsed === 'object') {
                if (Array.isArray(parsed.servers)) {
                    importedServers = parsed.servers;
                } else if (parsed.name && parsed.channelId) {
                    importedServers = [parsed];
                }
                if (parsed.globalWebhookUrl) {
                    globalWebhook = parsed.globalWebhookUrl;
                }
            }

            if (!importedServers || importedServers.length === 0) {
                alert('Invalid configuration file: No valid server profiles found in the selected JSON.');
                return;
            }

            let totalSchedules = 0;
            importedServers.forEach(s => {
                if (Array.isArray(s.schedules)) totalSchedules += s.schedules.length;
            });

            pendingImportData = {
                fileName: file.name,
                servers: importedServers,
                globalWebhookUrl: globalWebhook,
            };

            document.getElementById('importFileName').innerText = file.name;
            document.getElementById('importServerCount').innerText = importedServers.length;
            document.getElementById('importScheduleCount').innerText = totalSchedules;

            const webhookNotice = document.getElementById('importWebhookNotice');
            if (webhookNotice) {
                if (globalWebhook) {
                    webhookNotice.classList.remove('hidden');
                } else {
                    webhookNotice.classList.add('hidden');
                }
            }

            const modal = document.getElementById('importModal');
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }
        } catch (err) {
            alert(`Could not parse JSON configuration file: ${err.message}`);
        }
    };
    reader.readAsText(file);
}

function closeImportModal() {
    const modal = document.getElementById('importModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    pendingImportData = null;
}

async function confirmImportConfig() {
    if (!pendingImportData) return;

    const modeInput = document.querySelector('input[name="importMode"]:checked');
    const mode = modeInput ? modeInput.value : 'merge';

    const confirmBtn = document.getElementById('confirmImportBtn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerText = 'Importing...';
    }

    try {
        const res = await fetch('/api/config/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                servers: pendingImportData.servers,
                mode: mode,
                globalWebhookUrl: pendingImportData.globalWebhookUrl,
            })
        });

        const data = await res.json();
        if (data.success) {
            closeImportModal();
            await fetchConfig();
            await fetchStatus();
            alert(`✅ Successfully imported ${data.count} server profile(s) (${mode === 'merge' ? 'Merged with existing' : 'Replaced existing'}).`);
        } else {
            alert(`❌ Import failed: ${data.error || 'Unknown error'}`);
        }
    } catch (err) {
        alert(`Error importing configuration: ${err.message}`);
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerText = 'Confirm & Apply Import';
        }
    }
}

// Helper to calculate human-readable uptime tracking time since last successful check-in
function formatUptimeDuration(timestamp) {
    if (!timestamp) return null;
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    if (isNaN(then)) return null;

    const diffMs = Math.max(0, now - then);
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return '< 1m ago';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) {
        const remMins = diffMins % 60;
        return remMins > 0 ? `${diffHours}h ${remMins}m ago` : `${diffHours}h ago`;
    }
    const remHours = diffHours % 24;
    return remHours > 0 ? `${diffDays}d ${remHours}h ago` : `${diffDays}d ago`;
}

// --- DRAG-AND-DROP SCHEDULE REORDERING ---
let draggedScheduleState = null;

function onScheduleDragStart(e, serverId, index) {
    draggedScheduleState = { serverId: String(serverId), index: Number(index) };
    e.dataTransfer.effectAllowed = 'move';
    try {
        e.dataTransfer.setData('text/plain', JSON.stringify(draggedScheduleState));
    } catch (err) {}
    const tr = e.currentTarget;
    if (tr) {
        tr.classList.add('opacity-40', 'bg-indigo-500/10');
    }
}

function onScheduleDragOver(e, serverId, index) {
    if (!draggedScheduleState || draggedScheduleState.serverId !== String(serverId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tr = e.currentTarget;
    if (tr && !tr.classList.contains('border-t-2') && draggedScheduleState.index !== Number(index)) {
        tr.classList.add('border-t-2', 'border-discord-blurple', 'bg-discord-blurple/10');
    }
}

function onScheduleDragEnter(e, serverId, index) {
    if (!draggedScheduleState || draggedScheduleState.serverId !== String(serverId)) return;
    e.preventDefault();
}

function onScheduleDragLeave(e) {
    const tr = e.currentTarget;
    if (tr) {
        tr.classList.remove('border-t-2', 'border-discord-blurple', 'bg-discord-blurple/10');
    }
}

async function onScheduleDrop(e, targetServerId, targetIndex) {
    e.preventDefault();
    const tr = e.currentTarget;
    if (tr) {
        tr.classList.remove('border-t-2', 'border-discord-blurple', 'bg-discord-blurple/10');
    }

    let sourceServerId = draggedScheduleState ? draggedScheduleState.serverId : null;
    let sourceIndex = draggedScheduleState ? draggedScheduleState.index : -1;

    try {
        const raw = e.dataTransfer.getData('text/plain');
        if (raw) {
            const parsed = JSON.parse(raw);
            sourceServerId = String(parsed.serverId);
            sourceIndex = Number(parsed.index);
        }
    } catch (err) {}

    targetServerId = String(targetServerId);
    targetIndex = Number(targetIndex);

    if (!sourceServerId || sourceServerId !== targetServerId || sourceIndex === targetIndex || sourceIndex < 0) {
        return;
    }

    await reorderSchedules(targetServerId, sourceIndex, targetIndex);
}

function onScheduleDragEnd(e) {
    draggedScheduleState = null;
    document.querySelectorAll('.schedule-drag-row').forEach(row => {
        row.classList.remove('opacity-40', 'bg-indigo-500/10', 'border-t-2', 'border-discord-blurple', 'bg-discord-blurple/10');
    });
}

async function moveSchedulePriority(serverId, currentIndex, direction) {
    const targetIndex = Number(currentIndex) + Number(direction);
    const server = (currentConfig.servers || []).find(s => String(s.id) === String(serverId));
    if (!server || !server.schedules || targetIndex < 0 || targetIndex >= server.schedules.length) {
        return;
    }
    await reorderSchedules(serverId, currentIndex, targetIndex);
}

async function reorderSchedules(serverId, fromIndex, toIndex) {
    const server = (currentConfig.servers || []).find(s => String(s.id) === String(serverId));
    if (!server || !server.schedules) return;

    const [moved] = server.schedules.splice(fromIndex, 1);
    server.schedules.splice(toIndex, 0, moved);

    // Optimistically re-render to update execution sequence tags immediately
    renderServers();

    try {
        const scheduleIds = server.schedules.map(s => s.id);
        const res = await fetch(`/api/servers/${serverId}/schedules/reorder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scheduleIds })
        });

        if (res.ok) {
            showNotificationToast(`Priority updated: "${moved.label}" moved to #${toIndex + 1}`, 'success');
            if (typeof performAutoBackup === 'function') {
                performAutoBackup(true);
            }
        } else {
            // Fallback to saving whole config
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ servers: currentConfig.servers })
            });
            showNotificationToast(`Priority updated (#${toIndex + 1})`, 'success');
        }
    } catch (err) {
        console.warn('Notice reordering schedules:', err);
        showNotificationToast('Reordered schedules locally', 'info');
    }
}

// --- RENDER SERVER PROFILES ---
function renderServers() {
    const container = document.getElementById('serverListContainer');
    if (!container) return;

    const allServers = currentConfig.servers || [];

    // Update count badge in header
    const totalBadge = document.getElementById('serverCountBadge');
    if (totalBadge) totalBadge.innerText = allServers.length;

    if (allServers.length === 0) {
        const countStatus = document.getElementById('searchResultCount');
        if (countStatus) countStatus.innerText = 'No servers configured';

        const hasLocalBackup = Boolean(localStorage.getItem('attendancebot_local_backup'));

        container.innerHTML = `
            <div class="bg-discord-dark rounded-xl p-8 text-center border border-discord-border space-y-3">
                <div class="w-12 h-12 rounded-full bg-discord-card mx-auto flex items-center justify-center text-discord-blurple text-xl">
                    <i class="fa-solid fa-server"></i>
                </div>
                <h3 class="text-base font-bold text-white">No Discord Servers Configured</h3>
                <p class="text-xs text-discord-muted max-w-md mx-auto">
                    Add your first server profile with target channel and daily attendance schedules, or restore an offline snapshot.
                </p>
                <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
                    <button onclick="openAddServerModal()" class="px-4 py-2 rounded-lg text-xs font-bold bg-discord-blurple hover:bg-indigo-600 text-white shadow transition cursor-pointer">
                        + Add Server Profile
                    </button>
                    ${hasLocalBackup ? `
                    <button onclick="restoreFromLocalBackup()" class="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow transition cursor-pointer">
                        <i class="fa-solid fa-rotate-left mr-1"></i> Restore from Auto-Backup
                    </button>
                    ` : ''}
                    <button onclick="triggerImportConfig()" class="px-4 py-2 rounded-lg text-xs font-semibold bg-discord-card hover:bg-discord-border text-discord-text border border-discord-border transition cursor-pointer">
                        <i class="fa-solid fa-file-import mr-1"></i> Import JSON
                    </button>
                </div>
            </div>
        `;
        updateBulkSelectionUI();
        return;
    }

    // Filter by search query (name or channelId) and status filter
    const q = (serverSearchQuery || '').trim().toLowerCase();
    const filteredServers = getFilteredServers();

    const countStatus = document.getElementById('searchResultCount');
    if (countStatus) {
        const filterDesc = serverStatusFilter !== 'ALL' ? ` [${serverStatusFilter}]` : '';
        if (q || serverStatusFilter !== 'ALL') {
            countStatus.innerHTML = `Showing <strong class="text-white font-semibold">${filteredServers.length}</strong> of ${allServers.length} server${allServers.length === 1 ? '' : 's'}${filterDesc}`;
        } else {
            countStatus.innerText = `${allServers.length} server profile${allServers.length === 1 ? '' : 's'} configured`;
        }
    }

    if (filteredServers.length === 0) {
        container.innerHTML = `
            <div class="bg-discord-dark rounded-xl p-8 text-center border border-discord-border space-y-3">
                <div class="w-12 h-12 rounded-full bg-discord-card mx-auto flex items-center justify-center text-discord-muted text-xl">
                    <i class="fa-solid fa-magnifying-glass"></i>
                </div>
                <h3 class="text-base font-bold text-white">No Servers Match Your Filters</h3>
                <p class="text-xs text-discord-muted max-w-sm mx-auto">
                    ${q ? `No configured servers matching "<span class="text-discord-text font-mono">${escapeHtml(serverSearchQuery)}</span>"` : ''}
                    ${serverStatusFilter !== 'ALL' ? ` with status <strong class="text-white">${escapeHtml(serverStatusFilter)}</strong>.` : '.'}
                </p>
                <div class="flex items-center justify-center gap-2 pt-1">
                    ${q ? `
                    <button onclick="clearServerSearch()" class="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-discord-card hover:bg-discord-border text-white border border-discord-border transition cursor-pointer">
                        Clear Search Filter
                    </button>
                    ` : ''}
                    ${serverStatusFilter !== 'ALL' ? `
                    <button onclick="handleServerStatusFilter('ALL'); document.getElementById('serverStatusFilter').value = 'ALL';" class="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-discord-blurple hover:bg-indigo-600 text-white transition cursor-pointer">
                        Reset Status Filter
                    </button>
                    ` : ''}
                </div>
            </div>
        `;
        updateBulkSelectionUI();
        return;
    }

    container.innerHTML = filteredServers.map((server, serverIndex) => {
        // Detect 5-minute schedule trigger conflicts for this single channel
        const conflictAnalysis = analyzeServerScheduleConflicts(server);
        const { hasConflict, conflicts, conflictingScheduleIds } = conflictAnalysis;

        // Health Status resolution based on latest execution results
        const serverHealth = (currentStatus.serverHealth && currentStatus.serverHealth[server.id]) || null;
        let health = 'RUNNING';
        if (!server.active) {
            health = 'DISABLED';
        } else if (serverHealth && serverHealth.health === 'FAILED') {
            health = 'FAILED';
        } else if (serverHealth && serverHealth.health) {
            health = serverHealth.health;
        }

        // Color-coding styling based on health (green for Running, red for Failed, gray for Disabled)
        let cardBorder = 'border-emerald-500/50 shadow-[0_0_16px_rgba(87,242,135,0.07)] ring-1 ring-emerald-500/15';
        let cardHeaderBg = 'border-emerald-500/20 bg-emerald-500/5';
        let cardIconBox = 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400';
        let healthPill = `
            <span class="text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/35 inline-flex items-center gap-1.5 shadow-xs" title="Server health is Running - all recent executions succeeded">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Running</span>
            </span>
        `;

        if (health === 'DISABLED') {
            cardBorder = 'border-zinc-700/60 opacity-80';
            cardHeaderBg = 'border-zinc-700/50 bg-zinc-800/30';
            cardIconBox = 'bg-zinc-700/20 border-zinc-600/30 text-zinc-400';
            healthPill = `
                <span class="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-zinc-700/25 text-zinc-400 border border-zinc-600/30 inline-flex items-center gap-1.5" title="Server is Disabled - monitoring paused">
                    <span class="w-1.5 h-1.5 rounded-full bg-zinc-500"></span>
                    <span>Disabled</span>
                </span>
            `;
        } else if (health === 'FAILED') {
            cardBorder = 'border-rose-500/70 shadow-[0_0_20px_rgba(237,66,69,0.12)] ring-1 ring-rose-500/20';
            cardHeaderBg = 'border-rose-500/30 bg-rose-500/10';
            cardIconBox = 'bg-rose-500/15 border-rose-500/30 text-rose-400';
            healthPill = `
                <span class="text-xs px-2.5 py-0.5 rounded-full font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 inline-flex items-center gap-1.5 shadow-xs" title="Server health is Failed - recent execution failed">
                    <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                    <span>Failed</span>
                </span>
            `;
        }

        // Server Uptime & Last Successful Check-in calculation
        const lastSuccessTimestamp = serverHealth ? serverHealth.lastSuccessfulAt : null;
        const lastSuccessElapsed = lastSuccessTimestamp ? formatUptimeDuration(lastSuccessTimestamp) : null;
        let uptimeBadge = '';
        if (!server.active) {
            uptimeBadge = `
                <span class="text-xs px-2.5 py-0.5 rounded-full font-medium bg-zinc-700/25 text-zinc-400 border border-zinc-600/30 inline-flex items-center gap-1.5" title="Server monitoring is paused">
                    <i class="fa-solid fa-pause text-[10px]"></i>
                    <span>Paused</span>
                </span>
            `;
        } else if (lastSuccessTimestamp) {
            const dateFormatted = new Date(lastSuccessTimestamp).toLocaleString();
            uptimeBadge = `
                <span class="text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1.5 shadow-xs" title="Last successful attendance check-in: ${lastSuccessElapsed} (${dateFormatted})">
                    <i class="fa-regular fa-clock text-emerald-400 text-xs"></i>
                    <span>Check-in: ${lastSuccessElapsed}</span>
                </span>
            `;
        } else {
            uptimeBadge = `
                <span class="text-xs px-2.5 py-0.5 rounded-full font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/25 inline-flex items-center gap-1.5" title="Server Uptime: Waiting for first scheduled attendance check-in">
                    <i class="fa-regular fa-clock text-indigo-400 text-xs"></i>
                    <span>No check-ins yet</span>
                </span>
            `;
        }

        // Retain visual warning if timing conflict exists and server not failed
        if (hasConflict && health !== 'FAILED') {
            cardBorder = 'border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.08)] ring-1 ring-amber-500/15';
        }

        const isSelected = selectedServerIds.has(String(server.id));

        return `
        <div class="server-card-animate bg-discord-dark rounded-xl border ${cardBorder} overflow-hidden transition shadow-sm hover:border-discord-border/80" style="animation-delay: ${Math.min(serverIndex * 0.04, 0.28)}s;">
            <!-- Server Header -->
            <div class="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 border-b ${cardHeaderBg}">
                <div class="flex items-center space-x-3">
                    <input
                        type="checkbox"
                        class="server-select-checkbox w-4 h-4 rounded bg-discord-darker border-discord-border text-discord-blurple focus:ring-0 cursor-pointer"
                        data-server-id="${server.id}"
                        ${isSelected ? 'checked' : ''}
                        onchange="toggleServerSelection('${server.id}', this.checked)"
                        title="Select this server for bulk actions"
                    />
                    <div class="w-10 h-10 rounded-xl ${cardIconBox} border flex items-center justify-center font-bold text-base shrink-0">
                        <i class="fa-solid fa-hashtag"></i>
                    </div>
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <h3 class="font-bold text-white text-base">${escapeHtml(server.name)}</h3>
                            ${healthPill}
                            ${uptimeBadge}
                            ${hasConflict ? `
                                <span class="text-xs px-2.5 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1.5" title="Two or more schedules trigger within 5 minutes of each other in channel ${escapeHtml(server.channelId)}">
                                    <i class="fa-solid fa-triangle-exclamation text-[10px]"></i>
                                    <span>Timing Conflict (&le;5m)</span>
                                </span>
                            ` : ''}
                        </div>
                        <!-- Server Profile List Row Metadata with Elapsed Check-in Clock -->
                        <div class="flex flex-wrap items-center gap-2.5 text-xs text-discord-muted mt-1 mono">
                            <span>Channel ID: ${escapeHtml(server.channelId)}</span>
                            <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-discord-card border border-discord-border text-discord-text text-[11px] font-sans" title="Time elapsed since last successful attendance check-in for this server">
                                <i class="fa-regular fa-clock ${lastSuccessTimestamp ? 'text-emerald-400' : 'text-discord-muted'} text-[11px]"></i>
                                <span>Last success: <strong class="${lastSuccessTimestamp ? 'text-emerald-400' : 'text-discord-muted'}">${lastSuccessElapsed || 'Never'}</strong></span>
                            </span>
                            ${serverHealth && serverHealth.lastRunAt ? `
                                <span class="${health === 'FAILED' ? 'text-rose-300' : 'text-emerald-400/90'}">
                                    • Last Run: ${new Date(serverHealth.lastRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${escapeHtml(serverHealth.lastRunStatus || 'OK')})
                                </span>
                            ` : ''}
                            ${server.webhookUrl ? '<span class="text-indigo-300">• Custom Webhook</span>' : ''}
                        </div>
                    </div>
                </div>

                <div class="flex items-center space-x-2">
                    <button onclick="toggleServerActive('${server.id}')" title="${server.active ? 'Pause Server' : 'Resume Server'}" class="p-2 rounded-lg text-xs bg-discord-card hover:bg-discord-border text-discord-text border border-discord-border transition cursor-pointer">
                        <i class="fa-solid ${server.active ? 'fa-pause text-amber-400' : 'fa-play text-emerald-400'}"></i>
                    </button>
                    <button onclick="openEditServerModal('${server.id}')" title="Edit Server" class="p-2 rounded-lg text-xs bg-discord-card hover:bg-discord-border text-discord-text border border-discord-border transition cursor-pointer">
                        <i class="fa-solid fa-pencil text-gray-300"></i>
                    </button>
                    <button onclick="deleteServer('${server.id}')" title="Delete Server" class="p-2 rounded-lg text-xs bg-discord-card hover:bg-rose-500/20 text-rose-400 border border-discord-border transition cursor-pointer">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                    <button onclick="openAddScheduleModal('${server.id}')" class="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-discord-blurple hover:bg-indigo-600 text-white shadow transition cursor-pointer">
                        <i class="fa-solid fa-plus"></i>
                        <span>Add Schedule</span>
                    </button>
                </div>
            </div>

            <!-- HEALTH FAILURE ALERT BANNER -->
            ${health === 'FAILED' ? `
                <div class="mx-4 sm:mx-5 mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 shadow-sm flex items-start space-x-2.5">
                    <div class="text-rose-400 text-base mt-0.5 shrink-0">
                        <i class="fa-solid fa-circle-exclamation"></i>
                    </div>
                    <div class="space-y-0.5 flex-1 text-xs">
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-rose-300">Latest Task Failed</span>
                            ${serverHealth && serverHealth.lastRunAt ? `<span class="text-[11px] text-rose-300/80 mono">${new Date(serverHealth.lastRunAt).toLocaleTimeString()}</span>` : ''}
                        </div>
                        <p class="text-rose-200/90 font-mono text-[11px] leading-relaxed">
                            ${escapeHtml(serverHealth && serverHealth.lastError ? serverHealth.lastError : 'Recent attendance task encountered an error during dispatch.')}
                        </p>
                    </div>
                </div>
            ` : ''}

            <!-- VISUAL WARNING INDICATOR FOR OVERLAPPING SCHEDULES (<= 5min window) -->
            ${hasConflict ? `
                <div class="mx-4 sm:mx-5 mt-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 shadow-sm">
                    <div class="flex items-start space-x-3">
                        <div class="text-amber-400 text-base mt-0.5 shrink-0">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                        </div>
                        <div class="text-xs space-y-2 w-full">
                            <div class="flex flex-wrap items-center justify-between gap-1">
                                <span class="font-bold text-amber-300 text-sm">Schedule Trigger Conflict Detected (&le; 5-Minute Window)</span>
                                <span class="text-[11px] px-2 py-0.5 rounded bg-amber-500/20 font-mono text-amber-200 border border-amber-500/30">Channel: ${escapeHtml(server.channelId)}</span>
                            </div>
                            <p class="text-amber-200/90 leading-relaxed">
                                Two or more attendance schedules are set to trigger within the same <strong>5-minute window</strong> for this channel. Rapid automated posting or reacting in the same channel can lead to Discord rate limits, failed attendances, or anti-bot flags:
                            </p>
                            <div class="space-y-1.5 pt-0.5">
                                ${conflicts.map(c => `
                                    <div class="flex items-center space-x-2 text-xs bg-black/30 px-3 py-2 rounded-lg border border-amber-500/20 text-amber-100">
                                        <i class="fa-solid fa-clock text-amber-400 shrink-0"></i>
                                        <div class="flex-1">
                                            <span class="font-semibold text-white">"${escapeHtml(c.schedA.label)}"</span> <span class="text-amber-300 font-mono">(${c.timeAStr})</span>
                                            and
                                            <span class="font-semibold text-white">"${escapeHtml(c.schedB.label)}"</span> <span class="text-amber-300 font-mono">(${c.timeBStr})</span>
                                            trigger <span class="font-bold text-amber-400 underline decoration-amber-500/60">${c.diffMinutes} minute${c.diffMinutes === 1 ? '' : 's'}</span> apart.
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                            <p class="text-[11px] text-amber-400/80 pt-0.5">
                                💡 <strong>Tip:</strong> Re-schedule conflicting routines at least 10–15 minutes apart, or increase anti-detection jitter to stagger executions.
                            </p>
                        </div>
                    </div>
                </div>
            ` : ''}

            <!-- Schedules Table / List with Drag-and-Drop Reordering -->
            <div class="p-4 sm:p-5">
                ${!server.schedules || server.schedules.length === 0 ? `
                    <p class="text-xs text-discord-muted italic">No schedules defined for this server yet. Click "Add Schedule" to configure daily times.</p>
                ` : `
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-xs">
                            <thead>
                                <tr class="text-discord-muted uppercase tracking-wider border-b border-discord-border/40 pb-2">
                                    <th class="pb-2 font-semibold w-16 text-center" title="Execution Sequence Priority (Drag & drop rows to reorder)">Priority</th>
                                    <th class="pb-2 font-semibold">Schedule Label</th>
                                    <th class="pb-2 font-semibold">Frequency (Cron)</th>
                                    <th class="pb-2 font-semibold">Type & Payload</th>
                                    <th class="pb-2 font-semibold">Jitter</th>
                                    <th class="pb-2 font-semibold">Status</th>
                                    <th class="pb-2 font-semibold text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-discord-border/30" id="schedules-tbody-${server.id}">
                                ${server.schedules.map((sched, schedIndex) => {
                                    const isConflicting = conflictingScheduleIds.has(String(sched.id));
                                    return `
                                    <tr
                                        id="sched-row-${server.id}-${sched.id}"
                                        class="schedule-drag-row hover:bg-discord-card/30 transition select-none group ${isConflicting ? 'bg-amber-500/5' : ''}"
                                        draggable="true"
                                        ondragstart="onScheduleDragStart(event, '${server.id}', ${schedIndex})"
                                        ondragover="onScheduleDragOver(event, '${server.id}', ${schedIndex})"
                                        ondragenter="onScheduleDragEnter(event, '${server.id}', ${schedIndex})"
                                        ondragleave="onScheduleDragLeave(event)"
                                        ondrop="onScheduleDrop(event, '${server.id}', ${schedIndex})"
                                        ondragend="onScheduleDragEnd(event)"
                                        data-server-id="${server.id}"
                                        data-schedule-id="${sched.id}"
                                        data-index="${schedIndex}"
                                    >
                                        <td class="py-2.5 text-center whitespace-nowrap">
                                            <div class="inline-flex items-center gap-1.5 justify-center">
                                                <span class="cursor-grab active:cursor-grabbing text-discord-muted hover:text-white p-1 rounded hover:bg-discord-card transition inline-flex items-center" title="Drag & drop to reorder execution sequence priority">
                                                    <i class="fa-solid fa-grip-vertical text-xs group-hover:text-indigo-300"></i>
                                                </span>
                                                <span class="text-[10px] mono font-bold px-1.5 py-0.5 rounded bg-discord-card border border-discord-border text-discord-muted group-hover:text-white" title="Execution Sequence Priority #${schedIndex + 1}">
                                                    #${schedIndex + 1}
                                                </span>
                                                <div class="inline-flex flex-col ml-0.5 opacity-30 group-hover:opacity-100 transition">
                                                    ${schedIndex > 0 ? `
                                                        <button onclick="moveSchedulePriority('${server.id}', ${schedIndex}, -1); event.stopPropagation();" title="Move Up (Higher Priority)" class="text-[9px] text-discord-muted hover:text-white leading-none p-0.5 cursor-pointer">
                                                            <i class="fa-solid fa-chevron-up"></i>
                                                        </button>
                                                    ` : ''}
                                                    ${schedIndex < server.schedules.length - 1 ? `
                                                        <button onclick="moveSchedulePriority('${server.id}', ${schedIndex}, 1); event.stopPropagation();" title="Move Down (Lower Priority)" class="text-[9px] text-discord-muted hover:text-white leading-none p-0.5 cursor-pointer">
                                                            <i class="fa-solid fa-chevron-down"></i>
                                                        </button>
                                                    ` : ''}
                                                </div>
                                            </div>
                                        </td>
                                        <td class="py-2.5 font-medium text-white">
                                            <div class="flex items-center flex-wrap gap-1.5">
                                                <span>${escapeHtml(sched.label)}</span>
                                                ${sched.type === 'ONCE' ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">ONE-TIME</span>' : ''}
                                                ${isConflicting ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold inline-flex items-center gap-1" title="Triggers within 5 minutes of another schedule in this channel"><i class="fa-solid fa-triangle-exclamation text-[9px]"></i> &le;5m Window</span>' : ''}
                                            </div>
                                        </td>
                                        <td class="py-2.5 mono text-discord-muted">${escapeHtml(sched.cron)}</td>
                                        <td class="py-2.5">
                                            ${sched.attendanceType === 'REACTION' ? `
                                                <span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                                                    <span>Reaction:</span>
                                                    <span class="font-bold text-white">${escapeHtml(sched.emoji || '👍')}</span>
                                                </span>
                                            ` : `
                                                <span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 truncate max-w-[200px]" title="${escapeHtml(sched.message || 'Present')}">
                                                    <i class="fa-regular fa-comment-dots text-emerald-400 mr-1"></i>
                                                    <span class="truncate">"${escapeHtml((sched.message || 'Present').replace(/\n/g, ' ⏎ '))}"</span>
                                                </span>
                                            `}
                                        </td>
                                        <td class="py-2.5 text-discord-muted">${sched.maxJitterMinutes || 0}m jitter</td>
                                        <td class="py-2.5">
                                            <button onclick="toggleScheduleActive('${server.id}', '${sched.id}')" class="cursor-pointer">
                                                <span class="px-2 py-0.5 rounded text-[11px] font-semibold ${sched.active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'}">
                                                    ${sched.active ? 'Active' : 'Disabled'}
                                                </span>
                                            </button>
                                        </td>
                                        <td class="py-2.5 text-right space-x-1.5 whitespace-nowrap">
                                            <!-- Test Run Play Button -->
                                            <button
                                                id="btn-test-run-${server.id}-${sched.id}"
                                                onclick="triggerScheduleNow('${server.id}', '${sched.id}', this)"
                                                title="Test Run: Execute immediate one-time manual execution of this schedule"
                                                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/30 hover:border-emerald-500 text-xs font-semibold shadow-xs transition duration-150 cursor-pointer active:scale-95"
                                            >
                                                <i class="fa-solid fa-play text-[9px] text-emerald-400"></i>
                                                <span>Test Run</span>
                                            </button>
                                            <button onclick="openEditScheduleModal('${server.id}', '${sched.id}')" title="Edit Schedule" class="p-1.5 rounded bg-discord-card hover:bg-discord-border text-discord-muted hover:text-white transition cursor-pointer">
                                                <i class="fa-solid fa-pencil"></i>
                                            </button>
                                            <button onclick="deleteSchedule('${server.id}', '${sched.id}')" title="Delete Schedule" class="p-1.5 rounded bg-discord-card hover:bg-rose-500/20 text-discord-muted hover:text-rose-400 transition cursor-pointer">
                                                <i class="fa-solid fa-trash"></i>
                                            </button>
                                        </td>
                                    </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        </div>
        `;
    }).join('');

    updateBulkSelectionUI();
}

// --- SERVER MODAL ACTIONS ---
function openAddServerModal() {
    document.getElementById('serverModalTitle').innerText = 'Add Server Profile';
    document.getElementById('modalServerId').value = '';
    document.getElementById('modalServerName').value = '';
    document.getElementById('modalServerChannelId').value = '';
    document.getElementById('modalServerWebhook').value = '';
    document.getElementById('modalServerActive').checked = true;
    const modal = document.getElementById('serverModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function openEditServerModal(serverId) {
    const server = (currentConfig.servers || []).find(s => String(s.id) === String(serverId));
    if (!server) return;

    document.getElementById('serverModalTitle').innerText = 'Edit Server Profile';
    document.getElementById('modalServerId').value = server.id;
    document.getElementById('modalServerName').value = server.name;
    document.getElementById('modalServerChannelId').value = server.channelId;
    document.getElementById('modalServerWebhook').value = server.webhookUrl || '';
    document.getElementById('modalServerActive').checked = Boolean(server.active);
    const modal = document.getElementById('serverModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeServerModal() {
    const modal = document.getElementById('serverModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function handleSaveServer(e) {
    e.preventDefault();
    const id = document.getElementById('modalServerId').value;
    const name = document.getElementById('modalServerName').value;
    const channelId = document.getElementById('modalServerChannelId').value;
    const webhookUrl = document.getElementById('modalServerWebhook').value;
    const active = document.getElementById('modalServerActive').checked;

    try {
        let res;
        if (id) {
            // Update
            res = await fetch(`/api/servers/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, channelId, webhookUrl, active }),
            });
        } else {
            // Create
            res = await fetch('/api/servers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, channelId, webhookUrl, active }),
            });
        }
        if (res.ok) {
            closeServerModal();
            await fetchConfig();
            await fetchStatus();
        } else {
            const err = await res.json();
            alert(`Failed to save server: ${err.error || 'Unknown error'}`);
        }
    } catch (err) {
        alert(`Error saving server: ${err.message}`);
    }
}

async function toggleServerActive(serverId) {
    const server = (currentConfig.servers || []).find(s => String(s.id) === String(serverId));
    if (!server) return;

    try {
        await fetch(`/api/servers/${serverId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: !server.active }),
        });
        await fetchConfig();
        await fetchStatus();
    } catch (err) {
        alert(`Error toggling server: ${err.message}`);
    }
}

async function deleteServer(serverId) {
    const server = (currentConfig.servers || []).find(s => String(s.id) === String(serverId));
    if (!server) return;
    if (!confirm(`Are you sure you want to delete server "${server.name}" and all its schedules?`)) return;

    try {
        await fetch(`/api/servers/${serverId}`, { method: 'DELETE' });
        await fetchConfig();
        await fetchStatus();
    } catch (err) {
        alert(`Error deleting server: ${err.message}`);
    }
}

// --- SCHEDULE MODAL ACTIONS ---
function handleFrequencyChange() {
    const freq = document.getElementById('modalScheduleFrequency').value;
    const specificDayField = document.getElementById('specificDayField');
    const oneTimeDateField = document.getElementById('oneTimeDateField');
    const customCronField = document.getElementById('customCronField');

    specificDayField.classList.add('hidden');
    oneTimeDateField.classList.add('hidden');
    customCronField.classList.add('hidden');

    if (freq === 'specific_day') specificDayField.classList.remove('hidden');
    if (freq === 'once') oneTimeDateField.classList.remove('hidden');
    if (freq === 'custom') customCronField.classList.remove('hidden');

    updateScheduleCronAndLabel();
}

function updateScheduleCronAndLabel() {
    const freq = document.getElementById('modalScheduleFrequency').value;
    const timeVal = document.getElementById('modalScheduleTime').value || '09:00';
    const [hours, minutes] = timeVal.split(':').map(Number);

    let cron = `${minutes} ${hours} * * *`;
    let label = `${timeVal} (Everyday)`;

    if (freq === 'everyday') {
        cron = `${minutes} ${hours} * * *`;
        label = `${timeVal} (Everyday)`;
    } else if (freq === 'weekdays') {
        cron = `${minutes} ${hours} * * 1-5`;
        label = `${timeVal} (Weekdays)`;
    } else if (freq === 'weekends') {
        cron = `${minutes} ${hours} * * 0,6`;
        label = `${timeVal} (Weekends)`;
    } else if (freq === 'specific_day') {
        const day = document.getElementById('modalScheduleWeekday').value;
        const dayNames = { '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday', '4': 'Thursday', '5': 'Friday', '6': 'Saturday', '0': 'Sunday' };
        cron = `${minutes} ${hours} * * ${day}`;
        label = `${timeVal} (${dayNames[day] || 'Weekday'})`;
    } else if (freq === 'once') {
        const dateInput = document.getElementById('modalScheduleDate').value;
        if (dateInput) {
            const [y, m, d] = dateInput.split('-').map(Number);
            cron = `${minutes} ${hours} ${d} ${m} *`;
            label = `${timeVal} (${dateInput})`;
        } else {
            label = `${timeVal} (One-Time)`;
        }
    } else if (freq === 'custom') {
        const custom = document.getElementById('modalScheduleCustomCron').value;
        cron = custom || '* * * * *';
        label = `${timeVal} (Custom)`;
    }

    const labelInput = document.getElementById('modalScheduleLabel');
    if (labelInput && !labelInput.dataset.manual) {
        labelInput.value = label;
    }
}

function setMode(mode) {
    document.getElementById('modalScheduleType').value = mode;
    const msgBtn = document.getElementById('modeBtn-MESSAGE');
    const reactBtn = document.getElementById('modeBtn-REACTION');
    const msgContainer = document.getElementById('messageModeContainer');
    const reactContainer = document.getElementById('reactionModeContainer');

    if (mode === 'MESSAGE') {
        msgBtn.className = 'px-4 py-2 rounded-lg text-xs font-bold border border-discord-blurple bg-discord-blurple text-white flex items-center justify-center space-x-2 cursor-pointer';
        reactBtn.className = 'px-4 py-2 rounded-lg text-xs font-medium border border-discord-border bg-discord-card text-discord-muted hover:text-white flex items-center justify-center space-x-2 cursor-pointer';
        msgContainer.classList.remove('hidden');
        reactContainer.classList.add('hidden');
    } else {
        reactBtn.className = 'px-4 py-2 rounded-lg text-xs font-bold border border-discord-blurple bg-discord-blurple text-white flex items-center justify-center space-x-2 cursor-pointer';
        msgBtn.className = 'px-4 py-2 rounded-lg text-xs font-medium border border-discord-border bg-discord-card text-discord-muted hover:text-white flex items-center justify-center space-x-2 cursor-pointer';
        reactContainer.classList.remove('hidden');
        msgContainer.classList.add('hidden');
    }
}

function openAddScheduleModal(serverId) {
    document.getElementById('scheduleModalTitle').innerText = 'Add Attendance Schedule';
    document.getElementById('modalScheduleServerId').value = serverId;
    document.getElementById('modalScheduleId').value = '';
    document.getElementById('modalScheduleFrequency').value = 'weekdays';
    document.getElementById('modalScheduleTime').value = '09:00';
    document.getElementById('modalScheduleLabel').value = '09:00 (Weekdays)';
    delete document.getElementById('modalScheduleLabel').dataset.manual;
    document.getElementById('modalScheduleMessage').value = 'Present';
    document.getElementById('modalScheduleEmoji').value = '👍';
    document.getElementById('modalScheduleTargetMessageId').value = '';
    document.getElementById('modalScheduleJitter').value = '10';
    document.getElementById('jitterDisplay').innerText = '10 mins';
    document.getElementById('modalScheduleActive').checked = true;

    setMode('MESSAGE');
    handleFrequencyChange();

    const modal = document.getElementById('scheduleModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function openEditScheduleModal(serverId, scheduleId) {
    const server = (currentConfig.servers || []).find(s => String(s.id) === String(serverId));
    if (!server) return;
    const schedule = (server.schedules || []).find(sc => String(sc.id) === String(scheduleId));
    if (!schedule) return;

    document.getElementById('scheduleModalTitle').innerText = 'Edit Attendance Schedule';
    document.getElementById('modalScheduleServerId').value = serverId;
    document.getElementById('modalScheduleId').value = schedule.id;

    // Detect frequency from cron or type
    if (schedule.type === 'ONCE') {
        document.getElementById('modalScheduleFrequency').value = 'once';
        if (schedule.runDate) {
            document.getElementById('modalScheduleDate').value = schedule.runDate.split('T')[0];
        }
    } else if (schedule.cron.endsWith('1-5')) {
        document.getElementById('modalScheduleFrequency').value = 'weekdays';
    } else if (schedule.cron.endsWith('0,6')) {
        document.getElementById('modalScheduleFrequency').value = 'weekends';
    } else if (schedule.cron.endsWith('* * *')) {
        document.getElementById('modalScheduleFrequency').value = 'everyday';
    } else {
        document.getElementById('modalScheduleFrequency').value = 'custom';
        document.getElementById('modalScheduleCustomCron').value = schedule.cron;
    }

    document.getElementById('modalScheduleLabel').value = schedule.label;
    document.getElementById('modalScheduleLabel').dataset.manual = 'true';
    document.getElementById('modalScheduleMessage').value = schedule.message || 'Present';
    document.getElementById('modalScheduleEmoji').value = schedule.emoji || '👍';
    document.getElementById('modalScheduleTargetMessageId').value = schedule.targetMessageId || '';
    document.getElementById('modalScheduleJitter').value = schedule.maxJitterMinutes || 10;
    document.getElementById('jitterDisplay').innerText = (schedule.maxJitterMinutes || 10) + ' mins';
    document.getElementById('modalScheduleActive').checked = Boolean(schedule.active);

    setMode(schedule.attendanceType || 'MESSAGE');
    handleFrequencyChange();

    const modal = document.getElementById('scheduleModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeScheduleModal() {
    const modal = document.getElementById('scheduleModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function handleSaveSchedule(e) {
    e.preventDefault();
    const serverId = document.getElementById('modalScheduleServerId').value;
    const scheduleId = document.getElementById('modalScheduleId').value;

    const freq = document.getElementById('modalScheduleFrequency').value;
    const timeVal = document.getElementById('modalScheduleTime').value || '09:00';
    const [hours, minutes] = timeVal.split(':').map(Number);
    const label = document.getElementById('modalScheduleLabel').value;
    const mode = document.getElementById('modalScheduleType').value;
    const message = document.getElementById('modalScheduleMessage').value;
    const emoji = document.getElementById('modalScheduleEmoji').value;
    const targetMessageId = document.getElementById('modalScheduleTargetMessageId').value;
    const jitter = parseInt(document.getElementById('modalScheduleJitter').value, 10) || 0;
    const active = document.getElementById('modalScheduleActive').checked;

    let cron = `${minutes} ${hours} * * *`;
    let type = undefined;
    let runDate = undefined;

    if (freq === 'everyday') cron = `${minutes} ${hours} * * *`;
    else if (freq === 'weekdays') cron = `${minutes} ${hours} * * 1-5`;
    else if (freq === 'weekends') cron = `${minutes} ${hours} * * 0,6`;
    else if (freq === 'specific_day') {
        const day = document.getElementById('modalScheduleWeekday').value;
        cron = `${minutes} ${hours} * * ${day}`;
    } else if (freq === 'once') {
        type = 'ONCE';
        const dateInput = document.getElementById('modalScheduleDate').value;
        if (dateInput) {
            const [y, m, d] = dateInput.split('-').map(Number);
            cron = `${minutes} ${hours} ${d} ${m} *`;
            runDate = new Date(y, m - 1, d).toISOString();
        }
    } else if (freq === 'custom') {
        cron = document.getElementById('modalScheduleCustomCron').value || cron;
    }

    const payload = {
        label,
        cron,
        attendanceType: mode,
        message,
        emoji,
        targetMessageId,
        maxJitterMinutes: jitter,
        active,
        type,
        runDate,
    };

    try {
        let res;
        if (scheduleId) {
            res = await fetch(`/api/servers/${serverId}/schedules/${scheduleId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } else {
            res = await fetch(`/api/servers/${serverId}/schedules`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        }

        if (res.ok) {
            closeScheduleModal();
            await fetchConfig();
            await fetchStatus();
        } else {
            const err = await res.json();
            alert(`Failed to save schedule: ${err.error || 'Unknown error'}`);
        }
    } catch (err) {
        alert(`Error saving schedule: ${err.message}`);
    }
}

async function toggleScheduleActive(serverId, scheduleId) {
    const server = (currentConfig.servers || []).find(s => String(s.id) === String(serverId));
    if (!server) return;
    const schedule = (server.schedules || []).find(sc => String(sc.id) === String(scheduleId));
    if (!schedule) return;

    try {
        await fetch(`/api/servers/${serverId}/schedules/${scheduleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: !schedule.active }),
        });
        await fetchConfig();
        await fetchStatus();
    } catch (err) {
        alert(`Error toggling schedule: ${err.message}`);
    }
}

async function deleteSchedule(serverId, scheduleId) {
    if (!confirm('Are you sure you want to delete this schedule?')) return;
    try {
        await fetch(`/api/servers/${serverId}/schedules/${scheduleId}`, { method: 'DELETE' });
        await fetchConfig();
        await fetchStatus();
    } catch (err) {
        alert(`Error deleting schedule: ${err.message}`);
    }
}

async function triggerScheduleNow(serverId, scheduleId, btnElement) {
    let originalHtml = '';
    if (btnElement) {
        originalHtml = btnElement.innerHTML;
        btnElement.disabled = true;
        btnElement.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-[9px] text-amber-300"></i> <span>Running...</span>';
        btnElement.classList.add('opacity-75');
    }

    try {
        const res = await fetch(`/api/servers/${serverId}/schedules/${scheduleId}/trigger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ simulate: false }),
        });
        const data = await res.json();
        if (data.success) {
            triggerLocalSystemAlert({
                title: '⚡ Attendance Task Executed',
                body: data.message || 'Attendance schedule triggered successfully.'
            });
            showNotificationToast(data.message || 'Manual execution completed! Check-in recorded.', 'success');

            if (btnElement) {
                btnElement.innerHTML = '<i class="fa-solid fa-check text-[9px] text-emerald-300"></i> <span>Executed!</span>';
                btnElement.classList.remove('bg-emerald-500/15', 'text-emerald-300');
                btnElement.classList.add('bg-emerald-600', 'text-white');
            }

            // Immediately refresh status and stats so the elapsed check-in clock and uptime update in real time
            await fetchStatus();
            await fetchDailyCheckinStats();

            setTimeout(() => {
                if (btnElement) {
                    btnElement.innerHTML = originalHtml;
                    btnElement.disabled = false;
                    btnElement.classList.remove('opacity-75', 'bg-emerald-600', 'text-white');
                    btnElement.classList.add('bg-emerald-500/15', 'text-emerald-300');
                }
            }, 1800);
        } else {
            showNotificationToast(`Test run failed: ${data.error || 'Check activity log'}`, 'warning');
            if (btnElement) {
                btnElement.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-[9px] text-rose-300"></i> <span>Failed</span>';
                setTimeout(() => {
                    btnElement.innerHTML = originalHtml;
                    btnElement.disabled = false;
                    btnElement.classList.remove('opacity-75');
                }, 2000);
            }
        }
    } catch (err) {
        showNotificationToast(`Failed to trigger: ${err.message}`, 'error');
        if (btnElement) {
            btnElement.innerHTML = originalHtml;
            btnElement.disabled = false;
            btnElement.classList.remove('opacity-75');
        }
    }
}

// --- THEME MANAGEMENT (DARK / LIGHT MODE) ---
function initTheme() {
    const savedTheme = localStorage.getItem('attendancebot_theme') || 'dark';
    applyTheme(savedTheme, false);
}

function applyTheme(theme, persist = true) {
    currentTheme = theme;
    if (persist) {
        try {
            localStorage.setItem('attendancebot_theme', theme);
        } catch (e) {}
    }

    if (theme === 'light') {
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
        document.body.classList.add('light');
        document.body.classList.remove('dark');
    } else {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
        document.body.classList.add('dark');
        document.body.classList.remove('light');
    }

    updateThemeButtonUI();

    // Re-render Recharts chart so grid lines, axes, and tooltips re-render with clean contrast
    if (latestDailyData && Array.isArray(latestDailyData)) {
        renderRechartsCheckins(latestDailyData);
    }
}

function toggleTheme() {
    const isLightNow = currentTheme === 'light' || document.documentElement.classList.contains('light');
    const newTheme = isLightNow ? 'dark' : 'light';
    applyTheme(newTheme, true);
    showNotificationToast(`Switched to ${newTheme === 'light' ? 'Light' : 'Dark'} theme`, 'info');
}

function updateThemeButtonUI() {
    const btn = document.getElementById('themeToggleBtn');
    const icon = document.getElementById('themeToggleIcon');
    const text = document.getElementById('themeToggleText');
    if (!btn || !icon || !text) return;

    const isLightNow = currentTheme === 'light' || document.documentElement.classList.contains('light');
    if (isLightNow) {
        icon.className = 'fa-solid fa-moon text-indigo-500';
        text.innerText = 'Dark Mode';
        btn.setAttribute('title', 'Switch to Dark theme (Alt+T)');
    } else {
        icon.className = 'fa-solid fa-sun text-amber-400';
        text.innerText = 'Light Mode';
        btn.setAttribute('title', 'Switch to Light theme (Alt+T)');
    }
}

// --- LOG CONSOLE, ACTIVITY TRACKING & CSV EXPORT ---
function handleLogSearchInput(val) {
    logSearchQuery = (val || '').trim().toLowerCase();
    const clearBtn = document.getElementById('clearLogSearchBtn');
    if (clearBtn) {
        if (logSearchQuery) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }
    }
    renderFilteredLogs();
}

function handleLogLevelFilter(val) {
    logLevelFilter = val || 'ALL';
    renderFilteredLogs();
}

function clearLogSearch() {
    logSearchQuery = '';
    const input = document.getElementById('logSearchInput');
    if (input) input.value = '';
    const clearBtn = document.getElementById('clearLogSearchBtn');
    if (clearBtn) clearBtn.classList.add('hidden');
    renderFilteredLogs();
}

function isLogEntryMatching(entry) {
    if (!entry) return false;
    if (logLevelFilter !== 'ALL') {
        const lvl = (entry.level || 'INFO').toUpperCase();
        if (lvl !== logLevelFilter) return false;
    }
    if (logSearchQuery) {
        const msg = (entry.message || '').toLowerCase();
        const time = (entry.time || '').toLowerCase();
        const lvl = (entry.level || '').toLowerCase();
        if (!msg.includes(logSearchQuery) && !time.includes(logSearchQuery) && !lvl.includes(logSearchQuery)) {
            return false;
        }
    }
    return true;
}

function renderFilteredLogs() {
    const consoleEl = document.getElementById('logsConsole');
    if (!consoleEl) return;

    const filtered = currentSessionLogs.filter(isLogEntryMatching);
    const statusEl = document.getElementById('logFilterMatchStatus');
    if (statusEl) {
        if (logSearchQuery || logLevelFilter !== 'ALL') {
            statusEl.innerText = `Showing ${filtered.length} of ${currentSessionLogs.length}`;
            statusEl.classList.remove('hidden');
        } else {
            statusEl.innerText = '';
            statusEl.classList.add('hidden');
        }
    }

    consoleEl.innerHTML = '';
    if (filtered.length === 0) {
        consoleEl.innerHTML = `
            <div class="text-discord-muted py-8 text-center italic space-y-1">
                <i class="fa-solid fa-magnifying-glass text-lg opacity-40"></i>
                <p class="text-xs">No activity log entries match your search or filter criteria.</p>
            </div>
        `;
        return;
    }

    filtered.forEach(entry => appendSingleLogToDom(entry, false));

    const autoScroll = document.getElementById('autoScrollCheck');
    if (autoScroll && autoScroll.checked) {
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }
}

function appendSingleLogToDom(entry, shouldScroll = true) {
    const consoleEl = document.getElementById('logsConsole');
    if (!consoleEl) return;

    let badgeClass = 'text-blue-400 font-bold';
    if (entry.level === 'WARN') badgeClass = 'text-amber-400 font-bold';
    if (entry.level === 'ERROR') badgeClass = 'text-rose-400 font-bold';
    if (entry.level === 'SUCCESS') badgeClass = 'text-emerald-400 font-bold';

    const div = document.createElement('div');
    div.className = 'py-0.5 border-b border-discord-border/20 flex space-x-2 items-start';
    div.innerHTML = `
        <span class="text-gray-500 shrink-0 select-none">[${escapeHtml(entry.time || '')}]</span>
        <span class="${badgeClass} shrink-0">[${escapeHtml(entry.level || 'INFO')}]</span>
        <span class="text-gray-200 break-all">${escapeHtml(entry.message || '')}</span>
    `;

    consoleEl.appendChild(div);

    if (shouldScroll) {
        const autoScroll = document.getElementById('autoScrollCheck');
        if (autoScroll && autoScroll.checked) {
            consoleEl.scrollTop = consoleEl.scrollHeight;
        }
    }
}

function setupLogStream() {
    const consoleEl = document.getElementById('logsConsole');

    // First load recent history
    fetch('/api/logs')
        .then(r => r.json())
        .then(data => {
            if (data.logs && data.logs.length > 0) {
                currentSessionLogs = data.logs.slice();
                renderFilteredLogs();
                updateSessionLogCounter();
            }
        })
        .catch(() => {});

    // Hook up SSE stream
    try {
        const eventSource = new EventSource('/api/logs/stream');
        eventSource.onmessage = (e) => {
            try {
                const entry = JSON.parse(e.data);
                currentSessionLogs.push(entry);
                updateSessionLogCounter();

                if (isLogEntryMatching(entry)) {
                    appendSingleLogToDom(entry, true);
                }

                const statusEl = document.getElementById('logFilterMatchStatus');
                if (statusEl && (logSearchQuery || logLevelFilter !== 'ALL')) {
                    const filtered = currentSessionLogs.filter(isLogEntryMatching);
                    statusEl.innerText = `Showing ${filtered.length} of ${currentSessionLogs.length}`;
                }

                // Trigger local desktop notification on successful task completion
                if (entry && (entry.level === 'SUCCESS' || (entry.message && (
                    entry.message.includes('Message posted successfully') ||
                    entry.message.includes('Reacted with') ||
                    entry.message.includes('Attendance task executed live')
                )))) {
                    triggerLocalSystemAlert({
                        title: '⚡ Attendance Task Completed',
                        body: entry.message || 'Attendance routine successfully executed.'
                    });
                    // Also refresh stats chart & health
                    fetchDailyCheckinStats();
                }
            } catch (err) {
                // Ignore parse errors
            }
        };
        eventSource.onerror = () => {
            // Reconnect handled automatically by browser
        };
    } catch (e) {
        console.warn('SSE not supported, falling back to polling');
        setInterval(() => {
            fetch('/api/logs').then(r => r.json()).then(data => {
                if (data.logs) {
                    currentSessionLogs = data.logs.slice();
                    renderFilteredLogs();
                    updateSessionLogCounter();
                }
            });
        }, 3000);
    }
}

function appendLogEntryToDom(entry) {
    if (isLogEntryMatching(entry)) {
        appendSingleLogToDom(entry, true);
    }
}

// Backward compatibility alias
function appendLogEntry(entry) {
    currentSessionLogs.push(entry);
    appendLogEntryToDom(entry);
    updateSessionLogCounter();
}

function updateSessionLogCounter() {
    const badge = document.getElementById('logSessionCountBadge');
    if (badge) {
        const count = currentSessionLogs.length;
        badge.innerText = `${count} log${count === 1 ? '' : 's'}`;
        badge.setAttribute('title', `${count} activity log entries captured during current session`);
    }
}

async function clearLogs() {
    try {
        await fetch('/api/logs/clear', { method: 'POST' });
        currentSessionLogs = [];
        updateSessionLogCounter();
        renderFilteredLogs();
        showNotificationToast('Session activity logs cleared.', 'info');
    } catch (err) {
        console.warn('Failed to clear logs on server:', err && err.message ? err.message : err);
        showNotificationToast('Unable to clear server logs at this time', 'warning');
    }
}

// --- CSV LOG EXPORT ---
function exportLogsToCsv() {
    let logs = (currentSessionLogs && currentSessionLogs.length > 0)
        ? currentSessionLogs
        : extractLogsFromDom();

    if (!logs || logs.length === 0) {
        showNotificationToast('No activity logs in current session to export.', 'warning');
        return;
    }

    const escapeCsv = (val) => {
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
    };

    const headers = ['Entry #', 'Timestamp', 'Level', 'Message'];
    const rows = logs.map((log, index) => [
        index + 1,
        escapeCsv(log.time || new Date().toLocaleTimeString()),
        escapeCsv(log.level || 'INFO'),
        escapeCsv(log.message || '')
    ].join(','));

    // Prepend UTF-8 BOM (\uFEFF) for immediate compatibility with Excel & spreadsheet viewers
    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    link.download = `attendancebot-session-logs-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, 250);

    showNotificationToast(`Exported ${logs.length} session logs to CSV!`, 'success');
}

function extractLogsFromDom() {
    const consoleEl = document.getElementById('logsConsole');
    if (!consoleEl) return [];

    const lines = consoleEl.querySelectorAll('div');
    const extracted = [];
    lines.forEach(line => {
        const spans = line.querySelectorAll('span');
        if (spans.length >= 3) {
            const timeRaw = spans[0].innerText.replace(/^\[|\]$/g, '').trim();
            const levelRaw = spans[1].innerText.replace(/^\[|\]$/g, '').trim();
            const msgRaw = spans[2].innerText.trim();
            if (msgRaw) {
                extracted.push({ time: timeRaw, level: levelRaw, message: msgRaw });
            }
        }
    });
    return extracted;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// --- INTERACTIVE CLI TERMINAL ENGINE ---
let cliCommandHistory = [];
let cliHistoryIndex = -1;

function initCliTerminalShortcuts() {
    const input = document.getElementById('cliTerminalInput');
    if (!input) return;

    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (cliCommandHistory.length === 0) return;
            if (cliHistoryIndex === -1) {
                cliHistoryIndex = cliCommandHistory.length - 1;
            } else if (cliHistoryIndex > 0) {
                cliHistoryIndex--;
            }
            input.value = cliCommandHistory[cliHistoryIndex] || '';
            input.selectionStart = input.selectionEnd = input.value.length;
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (cliHistoryIndex === -1) return;
            if (cliHistoryIndex < cliCommandHistory.length - 1) {
                cliHistoryIndex++;
                input.value = cliCommandHistory[cliHistoryIndex] || '';
            } else {
                cliHistoryIndex = -1;
                input.value = '';
            }
            input.selectionStart = input.selectionEnd = input.value.length;
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initCliTerminalShortcuts();
});

async function handleCliTerminalSubmit(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('cliTerminalInput');
    if (!input) return;
    const cmd = input.value.trim();
    if (!cmd) return;

    // Push to history
    cliCommandHistory.push(cmd);
    cliHistoryIndex = -1;
    input.value = '';

    await executeCliCommand(cmd);
}

async function runCliChip(cmd) {
    switchTab('cli');
    const input = document.getElementById('cliTerminalInput');
    if (input) {
        input.value = cmd;
    }
    cliCommandHistory.push(cmd);
    cliHistoryIndex = -1;
    await executeCliCommand(cmd);
}

async function executeCliCommand(commandLine) {
    const terminalOutput = document.getElementById('cliTerminalOutput');
    const submitBtn = document.getElementById('cliSubmitBtn');

    if (!terminalOutput) return;

    // Render User Command Prompt
    const cmdEl = document.createElement('div');
    cmdEl.className = 'mt-2 pt-1 border-t border-zinc-800/80 flex items-start gap-1.5';
    cmdEl.innerHTML = `
        <span class="text-emerald-400 font-bold select-none">attendancebot:~$</span>
        <span class="text-white font-semibold">${escapeHtml(commandLine)}</span>
    `;
    terminalOutput.appendChild(cmdEl);

    // Disable button temporarily
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    try {
        const res = await fetch('/api/cli/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: commandLine })
        });

        const data = await res.json();

        if (data.isClear) {
            terminalOutput.innerHTML = `
                <div class="text-emerald-400 font-bold">⚡ Terminal Cleared</div>
                <div class="text-zinc-500 text-[11px] pb-2 border-b border-zinc-800">Connected to live spinning server. Type <span class="text-discord-blurple font-bold">help</span> for commands.</div>
            `;
        } else {
            const outEl = document.createElement('div');
            outEl.className = data.success ? 'text-zinc-300 whitespace-pre-wrap' : 'text-rose-400 whitespace-pre-wrap';
            outEl.textContent = data.output || '(No output)';
            terminalOutput.appendChild(outEl);
        }

        // Auto-refresh config and status if mutation command executed
        const lower = commandLine.toLowerCase();
        if (
            lower.startsWith('server') ||
            lower.startsWith('schedule') ||
            lower.startsWith('start') ||
            lower.startsWith('stop') ||
            lower.startsWith('restart') ||
            lower.startsWith('token') ||
            lower.startsWith('webhook') ||
            lower.startsWith('trigger')
        ) {
            await fetchConfig();
            await fetchStatus();
        }
    } catch (err) {
        const errEl = document.createElement('div');
        errEl.className = 'text-rose-400';
        errEl.textContent = `❌ CLI Communication Error: ${err.message}`;
        terminalOutput.appendChild(errEl);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Run';
        }
        // Auto scroll to bottom
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
        const input = document.getElementById('cliTerminalInput');
        if (input) input.focus();
    }
}

function clearCliTerminal() {
    const terminalOutput = document.getElementById('cliTerminalOutput');
    if (terminalOutput) {
        terminalOutput.innerHTML = `
            <div class="text-emerald-400 font-bold">⚡ Terminal Cleared</div>
            <div class="text-zinc-500 text-[11px] pb-2 border-b border-zinc-800">Connected to live spinning server. Type <span class="text-discord-blurple font-bold">help</span> for commands.</div>
        `;
    }
    const input = document.getElementById('cliTerminalInput');
    if (input) input.focus();
}

function copyCliTerminalOutput() {
    const terminalOutput = document.getElementById('cliTerminalOutput');
    if (!terminalOutput) return;
    const text = terminalOutput.innerText;
    navigator.clipboard.writeText(text).then(() => {
        showNotificationToast('Terminal output copied to clipboard!', 'success');
    }).catch(() => {
        showNotificationToast('Failed to copy to clipboard', 'warning');
    });
}

