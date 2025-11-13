import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 系统负载监控器
 * 用于收集和统计服务器资源使用情况
 */
class SystemMonitor {
    constructor() {
        this.userLoadStats = new Map(); // 存储每个用户的负载统计
        this.systemLoadHistory = []; // 系统负载历史记录
        this.maxHistoryLength = 100; // 最多保存100条历史记录
        this.startTime = Date.now();
        this.lastCpuUsage = process.cpuUsage();
        this.lastNetworkStats = this.getNetworkStats();
        this.lastDurationUpdate = 0; // 上次更新在线时长的时间

        // CPU使用率计算相关
        this.lastCpuInfo = this.getCpuInfo();
        this.lastCpuTime = Date.now();
        this.cpuUsageHistory = []; // CPU使用率历史，用于平滑处理
        this.maxCpuHistoryLength = 6; // 保存最近6次测量（30秒）

        // 数据持久化相关
        this.dataDir = path.join(process.cwd(), 'data', 'system-monitor');
        this.userStatsFile = path.join(this.dataDir, 'user-stats.json');
        this.loadHistoryFile = path.join(this.dataDir, 'load-history.json');
        this.systemStatsFile = path.join(this.dataDir, 'system-stats.json');

        // 确保数据目录存在
        this.ensureDataDirectory();

        // 加载历史数据
        this.loadPersistedData();

        // 定期更新系统负载
        this.updateInterval = setInterval(() => {
            this.updateSystemLoad();
        }, 5000); // 每5秒更新一次

        // 定期保存数据（每30秒）
        this.saveInterval = setInterval(() => {
            this.saveDataToDisk();
        }, 30000);

        // 定期更新用户在线时长（每1分钟）
        this.userUpdateInterval = setInterval(() => {
            this.updateOnlineUsersDuration();
        }, 60000);
    }

    /**
     * 获取当前系统负载信息
     * @returns {Object} 系统负载信息
     */
    getSystemLoad() {
        const cpuUsage = this.getCpuUsage();
        const memoryUsage = this.getMemoryUsage();
        const diskUsage = this.getDiskUsage();
        const networkUsage = this.getNetworkUsage();
        const uptime = this.getUptime();

        return {
            timestamp: Date.now(),
            cpu: cpuUsage,
            memory: memoryUsage,
            disk: diskUsage,
            network: networkUsage,
            uptime: uptime,
            loadAverage: os.loadavg(),
        };
    }

    /**
     * 获取CPU信息（用于计算使用率）
     * @returns {Object} CPU信息
     */
    getCpuInfo() {
        const cpus = os.cpus();
        let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;

        for (let cpu of cpus) {
            user += cpu.times.user;
            nice += cpu.times.nice;
            sys += cpu.times.sys;
            idle += cpu.times.idle;
            irq += cpu.times.irq;
        }

        const total = user + nice + sys + idle + irq;

        return {
            user,
            nice,
            sys,
            idle,
            irq,
            total,
        };
    }

    /**
     * 获取CPU使用率（系统级别）
     * @returns {Object} CPU使用信息
     */
    getCpuUsage() {
        const currentTime = Date.now();
        const currentCpuInfo = this.getCpuInfo();

        // 计算时间差和CPU时间差
        const totalDelta = currentCpuInfo.total - this.lastCpuInfo.total;
        const idleDelta = currentCpuInfo.idle - this.lastCpuInfo.idle;

        let cpuPercent = 0;
        if (totalDelta > 0) {
            cpuPercent = ((totalDelta - idleDelta) / totalDelta) * 100;
        }

        // 添加到历史记录进行平滑处理
        this.cpuUsageHistory.push(cpuPercent);
        if (this.cpuUsageHistory.length > this.maxCpuHistoryLength) {
            this.cpuUsageHistory.shift();
        }

        // 计算平滑后的CPU使用率（移动平均）
        const smoothedCpuPercent = this.cpuUsageHistory.reduce((sum, val) => sum + val, 0) / this.cpuUsageHistory.length;

        // 更新上次的值
        this.lastCpuInfo = currentCpuInfo;
        this.lastCpuTime = currentTime;

        const cpus = os.cpus();

        return {
            percent: Math.min(100, Math.max(0, smoothedCpuPercent)),
            raw: Math.min(100, Math.max(0, cpuPercent)), // 原始值，用于调试
            cores: cpus.length,
            model: cpus[0]?.model || 'Unknown',
            speed: cpus[0]?.speed || 0,
            loadAverage: os.loadavg(), // 添加系统负载平均值
            user: totalDelta > 0 ? ((currentCpuInfo.user - this.lastCpuInfo?.user || 0) / totalDelta) * 100 : 0,
            system: totalDelta > 0 ? ((currentCpuInfo.sys - this.lastCpuInfo?.sys || 0) / totalDelta) * 100 : 0,
            idle: totalDelta > 0 ? (idleDelta / totalDelta) * 100 : 0,
        };
    }

    /**
     * 获取内存使用情况
     * @returns {Object} 内存使用信息
     */
    getMemoryUsage() {
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemory = totalMemory - freeMemory;
        const processMemory = process.memoryUsage();

        return {
            total: totalMemory,
            used: usedMemory,
            free: freeMemory,
            percent: (usedMemory / totalMemory) * 100,
            process: {
                rss: processMemory.rss,
                heapTotal: processMemory.heapTotal,
                heapUsed: processMemory.heapUsed,
                external: processMemory.external,
            },
        };
    }

    /**
     * 获取磁盘使用情况
     * @returns {Object} 磁盘使用信息
     */
    getDiskUsage() {
        try {
            fs.statSync(process.cwd());
            return {
                available: true,
                path: process.cwd(),
                // 简化的磁盘信息，实际项目中可能需要更详细的实现
                usage: 'N/A',
            };
        } catch (error) {
            return {
                available: false,
                error: error.message,
            };
        }
    }

    /**
     * 获取网络使用情况
     * @returns {Object} 网络使用信息
     */
    getNetworkUsage() {
        const currentStats = this.getNetworkStats();
        const deltaTime = 5; // 5秒间隔

        let bytesIn = 0;
        let bytesOut = 0;

        if (this.lastNetworkStats) {
            bytesIn = (currentStats.bytesIn - this.lastNetworkStats.bytesIn) / deltaTime;
            bytesOut = (currentStats.bytesOut - this.lastNetworkStats.bytesOut) / deltaTime;
        }

        this.lastNetworkStats = currentStats;

        return {
            interfaces: os.networkInterfaces(),
            bytesPerSecIn: Math.max(0, bytesIn),
            bytesPerSecOut: Math.max(0, bytesOut),
            totalBytesIn: currentStats.bytesIn,
            totalBytesOut: currentStats.bytesOut,
        };
    }

    /**
     * 获取网络统计数据
     * @returns {Object} 网络统计
     */
    getNetworkStats() {
        // 简化实现，实际项目中可能需要读取 /proc/net/dev (Linux) 或其他系统特定文件
        return {
            bytesIn: Math.floor(Math.random() * 1000000), // 模拟数据
            bytesOut: Math.floor(Math.random() * 1000000),
        };
    }

    /**
     * 获取系统运行时间
     * @returns {Object} 运行时间信息
     */
    getUptime() {
        const systemUptime = os.uptime();
        const processUptime = (Date.now() - this.startTime) / 1000;

        return {
            system: systemUptime,
            process: processUptime,
            systemFormatted: this.formatUptime(systemUptime),
            processFormatted: this.formatUptime(processUptime),
        };
    }

    /**
     * 格式化运行时间
     * @param {number} seconds 秒数
     * @returns {string} 格式化的时间字符串
     */
    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        return `${days}天 ${hours}时 ${minutes}分 ${secs}秒`;
    }

    /**
     * 更新系统负载历史记录（只在有用户活跃时记录）
     */
    updateSystemLoad() {
        // 检查是否有活跃用户
        const currentTime = Date.now();
        const activeThreshold = 10 * 60 * 1000; // 10分钟内活跃的用户
        let hasActiveUsers = false;

        for (const [, stats] of this.userLoadStats) {
            if (currentTime - stats.lastActivity <= activeThreshold) {
                hasActiveUsers = true;
                break;
            }
        }

        // 只在有活跃用户时记录系统负载
        if (hasActiveUsers) {
            const currentLoad = this.getSystemLoad();
            // 添加活跃用户数量信息
            currentLoad.activeUsers = this.getActiveUserCount();
            this.systemLoadHistory.push(currentLoad);

            // 保持历史记录在限定长度内
            if (this.systemLoadHistory.length > this.maxHistoryLength) {
                this.systemLoadHistory.shift();
            }
        }
    }

    /**
     * 获取活跃用户数量
     * @returns {number} 活跃用户数量
     */
    getActiveUserCount() {
        const currentTime = Date.now();
        const activeThreshold = 10 * 60 * 1000; // 10分钟内活跃的用户
        let activeCount = 0;

        for (const [, stats] of this.userLoadStats) {
            if (currentTime - stats.lastActivity <= activeThreshold) {
                activeCount++;
            }
        }

        return activeCount;
    }

    /**
     * 记录用户聊天活动
     * @param {string} userHandle 用户句柄
     * @param {string} messageType 消息类型 ('user' 或 'character')
     * @param {Object} messageData 消息数据
     */
    recordUserChatActivity(userHandle, messageType, messageData = {}) {
        const now = Date.now();

        if (!this.userLoadStats.has(userHandle)) {
            this.userLoadStats.set(userHandle, {
                userHandle: userHandle,
                userName: messageData.userName || userHandle, // 用户显示名称
                totalUserMessages: 0,      // 用户发送的消息数
                totalCharacterMessages: 0, // AI回复的消息数
                totalMessages: 0,          // 总消息数（楼层数）
                sessionsToday: 0,          // 今日会话次数
                lastActivity: now,
                firstActivity: now,
                todayMessages: 0,          // 今日消息数
                lastChatTime: now,         // 最后聊天时间
                lastSessionTime: now,      // 最后会话开始时间
                onlineDuration: 0,         // 在线总时长（毫秒）
                currentSessionStart: now,  // 当前会话开始时间
                isOnline: true,            // 是否在线
                sessionCount: 1,           // 总会话次数
                lastMessageTime: now,
                characterChats: {},        // 按角色分组的聊天统计
                dailyStats: {},             // 按日期统计
            });
        }

        const userStats = this.userLoadStats.get(userHandle);
        const today = new Date().toDateString();

        // 更新用户名（如果提供了新的用户名）
        if (messageData.userName && messageData.userName !== userStats.userName) {
            userStats.userName = messageData.userName;
        }

        // 更新基本统计
        userStats.totalMessages++;
        userStats.lastActivity = now;
        userStats.lastChatTime = now; // 更新最后聊天时间
        userStats.lastMessageTime = now;
        userStats.isOnline = true;

        // 如果用户之前离线，现在重新上线
        if (!userStats.currentSessionStart) {
            userStats.currentSessionStart = now;
            userStats.sessionCount++;
        }

        // 按消息类型统计
        if (messageType === 'user') {
            userStats.totalUserMessages++;
        } else if (messageType === 'character') {
            userStats.totalCharacterMessages++;
        }

        // 今日统计
        if (!userStats.dailyStats[today]) {
            userStats.dailyStats[today] = {
                messages: 0,
                userMessages: 0,
                characterMessages: 0,
                firstMessage: now,
            };
        }

        const todayStats = userStats.dailyStats[today];
        todayStats.messages++;
        if (messageType === 'user') {
            todayStats.userMessages++;
        } else if (messageType === 'character') {
            todayStats.characterMessages++;
        }

        userStats.todayMessages = todayStats.messages;

        // 按角色统计
        if (messageData.characterName) {
            if (!userStats.characterChats[messageData.characterName]) {
                userStats.characterChats[messageData.characterName] = {
                    totalMessages: 0,
                    userMessages: 0,
                    characterMessages: 0,
                    lastChat: now,
                };
            }

            const charStats = userStats.characterChats[messageData.characterName];
            charStats.totalMessages++;
            charStats.lastChat = now;

            if (messageType === 'user') {
                charStats.userMessages++;
            } else if (messageType === 'character') {
                charStats.characterMessages++;
            }
        }
    }

    /**
     * 记录用户登录
     * @param {string} userHandle - 用户句柄
     * @param {Object} options - 选项
     */
    recordUserLogin(userHandle, options = {}) {
        if (!userHandle) return;

        const now = Date.now();

        if (!this.userLoadStats.has(userHandle)) {
            this.userLoadStats.set(userHandle, {
                userHandle: userHandle,
                userName: options.userName || userHandle,
                totalUserMessages: 0,
                totalCharacterMessages: 0,
                totalMessages: 0,
                sessionsToday: 0,
                lastActivity: now,
                firstActivity: now,
                todayMessages: 0,
                lastChatTime: null,
                lastSessionTime: now,
                onlineDuration: 0,
                currentSessionStart: now,
                isOnline: true,
                sessionCount: 1,
                lastMessageTime: now,
                characterChats: {},
                dailyStats: {},
                // 新增心跳相关字段
                lastHeartbeat: null,
                lastHeartbeatTime: null,
            });
        } else {
            const userStats = this.userLoadStats.get(userHandle);
            userStats.lastSessionTime = now;
            userStats.currentSessionStart = now;
            userStats.isOnline = true;
            userStats.sessionCount++;

            // 确保新字段存在
            if (!userStats.lastHeartbeat) {
                userStats.lastHeartbeat = null;
            }
            if (!userStats.lastHeartbeatTime) {
                userStats.lastHeartbeatTime = null;
            }

            // 更新用户名
            if (options.userName && options.userName !== userStats.userName) {
                userStats.userName = options.userName;
            }
        }

        console.log(`User login recorded: ${userHandle} at ${new Date(now).toISOString()}`);
    }

    /**
     * 记录用户离线
     * @param {string} userHandle - 用户句柄
     */
    recordUserLogout(userHandle) {
        if (!userHandle || !this.userLoadStats.has(userHandle)) return;

        const userStats = this.userLoadStats.get(userHandle);
        const now = Date.now();

        if (userStats.currentSessionStart) {
            // 计算本次会话时长
            const sessionDuration = now - userStats.currentSessionStart;
            userStats.onlineDuration += sessionDuration;
            userStats.currentSessionStart = null;
        }

        userStats.isOnline = false;
        userStats.lastActivity = now;

        console.log(`User logout recorded: ${userHandle}, total online duration: ${this.formatDuration(userStats.onlineDuration)}`);
    }

    /**
     * 更新用户活动状态
     * @param {string} userHandle - 用户句柄
     * @param {Object} options - 选项
     */
    updateUserActivity(userHandle, options = {}) {
        if (!userHandle) return;

        const now = Date.now();

        if (this.userLoadStats.has(userHandle)) {
            const userStats = this.userLoadStats.get(userHandle);

            // 记录活动类型
            const activityType = options.isHeartbeat ? 'heartbeat' : 'request';

            // 更新最后活动时间
            userStats.lastActivity = now;
            userStats.lastHeartbeat = options.isHeartbeat ? now : userStats.lastHeartbeat;
            userStats.isOnline = true;

            // 如果用户之前被标记为离线，重新开始会话
            if (!userStats.currentSessionStart) {
                userStats.currentSessionStart = now;
                userStats.sessionCount++;
                console.log(`User ${userHandle} session resumed (${activityType})`);
            }

            // 更新用户名
            if (options.userName && options.userName !== userStats.userName) {
                userStats.userName = options.userName;
            }

            // 记录活动日志（可选，用于调试）
            if (options.isHeartbeat) {
                userStats.lastHeartbeatTime = now;
            }
        }
    }

    /**
     * 更新在线用户的会话时长
     */
    updateOnlineUsersDuration() {
        const now = Date.now();
        const heartbeatTimeout = 5 * 60 * 1000; // 5分钟没有心跳认为可能离线
        const inactiveTimeout = 15 * 60 * 1000; // 15分钟没有任何活动认为离线

        for (const [userHandle, userStats] of this.userLoadStats.entries()) {
            if (userStats.isOnline && userStats.currentSessionStart) {
                const timeSinceLastActivity = now - userStats.lastActivity;
                const timeSinceLastHeartbeat = userStats.lastHeartbeat ? now - userStats.lastHeartbeat : timeSinceLastActivity;

                // 智能离线检测逻辑
                let shouldMarkOffline = false;
                let reason = '';

                // 如果有心跳记录，优先使用心跳超时
                if (userStats.lastHeartbeat && timeSinceLastHeartbeat > heartbeatTimeout) {
                    // 心跳超时，但还要检查是否有其他活动
                    if (timeSinceLastActivity > heartbeatTimeout) {
                        shouldMarkOffline = true;
                        reason = `heartbeat timeout (${Math.floor(timeSinceLastHeartbeat / 60000)}min)`;
                    }
                }
                // 如果没有心跳记录，使用传统的活动超时
                else if (!userStats.lastHeartbeat && timeSinceLastActivity > inactiveTimeout) {
                    shouldMarkOffline = true;
                    reason = `activity timeout (${Math.floor(timeSinceLastActivity / 60000)}min)`;
                }
                // 如果有心跳但总活动时间过长，也认为离线
                else if (timeSinceLastActivity > inactiveTimeout) {
                    shouldMarkOffline = true;
                    reason = `extended inactivity (${Math.floor(timeSinceLastActivity / 60000)}min)`;
                }

                if (shouldMarkOffline) {
                    console.log(`User ${userHandle} marked offline due to ${reason}`);
                    this.recordUserLogout(userHandle);
                }
            }
        }
    }

    /**
     * 格式化时长
     * @param {number} duration - 时长（毫秒）
     * @returns {string} 格式化的时长
     */
    formatDuration(duration) {
        if (!duration || duration < 0) return '0分钟';

        const seconds = Math.floor(duration / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}天${hours % 24}小时${minutes % 60}分钟`;
        } else if (hours > 0) {
            return `${hours}小时${minutes % 60}分钟`;
        } else if (minutes > 0) {
            return `${minutes}分钟`;
        } else {
            return `${seconds}秒`;
        }
    }

    /**
     * 获取用户聊天统计
     * @param {string} userHandle 用户句柄
     * @returns {Object} 用户聊天统计
     */
    getUserLoadStats(userHandle) {
        const userStats = this.userLoadStats.get(userHandle);
        if (!userStats) {
            return null;
        }

        const currentTime = Date.now();
        const activeTime = currentTime - userStats.firstActivity;
        const today = new Date().toDateString();
        const todayStats = userStats.dailyStats[today] || {};

        // 计算当前在线时长
        let currentOnlineDuration = userStats.onlineDuration;
        let currentSessionDuration = 0;

        if (userStats.isOnline && userStats.currentSessionStart) {
            // 当前会话时长
            currentSessionDuration = currentTime - userStats.currentSessionStart;

            // 总在线时长 = 历史累计时长 + 当前会话时长
            currentOnlineDuration = userStats.onlineDuration + currentSessionDuration;
        }

        // 计算在线状态描述
        let onlineStatusText = '离线';
        if (userStats.isOnline) {
            if (userStats.lastHeartbeat) {
                const heartbeatAge = currentTime - userStats.lastHeartbeat;
                if (heartbeatAge < 5 * 60 * 1000) { // 5分钟内有心跳
                    onlineStatusText = '在线';
                } else {
                    onlineStatusText = '可能离线';
                }
            } else {
                onlineStatusText = '在线（无心跳）';
            }
        }

        return {
            userHandle: userHandle,
            userName: userStats.userName || userHandle,
            totalMessages: userStats.totalMessages,
            totalUserMessages: userStats.totalUserMessages,
            totalCharacterMessages: userStats.totalCharacterMessages,
            todayMessages: userStats.todayMessages,

            // 时间相关统计
            lastChatTime: userStats.lastChatTime,
            lastChatTimeFormatted: userStats.lastChatTime ? new Date(userStats.lastChatTime).toLocaleString('zh-CN') : '从未聊天',
            lastSessionTime: userStats.lastSessionTime,
            lastSessionTimeFormatted: new Date(userStats.lastSessionTime).toLocaleString('zh-CN'),
            lastActivity: userStats.lastActivity,
            lastActivityFormatted: new Date(userStats.lastActivity).toLocaleString('zh-CN'),

            // 在线时长统计
            onlineDuration: currentOnlineDuration,
            onlineDurationFormatted: this.formatDuration(currentOnlineDuration),
            currentSessionDuration: currentSessionDuration,
            currentSessionDurationFormatted: this.formatDuration(currentSessionDuration),
            isOnline: userStats.isOnline,
            onlineStatusText: onlineStatusText,
            sessionCount: userStats.sessionCount,
            lastHeartbeat: userStats.lastHeartbeat,
            lastHeartbeatFormatted: userStats.lastHeartbeat ? new Date(userStats.lastHeartbeat).toLocaleString('zh-CN') : '无',

            // 其他统计
            activeTime: activeTime,
            activeTimeFormatted: this.formatUptime(activeTime / 1000),
            avgMessagesPerDay: this.calculateAvgMessagesPerDay(userStats),
            lastMessageTime: userStats.lastMessageTime,
            lastMessageTimeFormatted: new Date(userStats.lastMessageTime).toLocaleString('zh-CN'),
            characterChats: userStats.characterChats,
            todayStats: todayStats,
            chatActivityLevel: this.calculateChatActivityLevel(userStats),
        };
    }

    /**
     * 计算用户平均每日消息数
     * @param {Object} userStats 用户统计数据
     * @returns {number} 平均每日消息数
     */
    calculateAvgMessagesPerDay(userStats) {
        const dailyStats = userStats.dailyStats;
        const days = Object.keys(dailyStats).length;
        if (days === 0) return 0;

        return Math.round(userStats.totalMessages / days);
    }

    /**
     * 计算用户聊天活跃度等级
     * @param {Object} userStats 用户统计数据
     * @returns {string} 活跃度等级
     */
    calculateChatActivityLevel(userStats) {
        const todayMessages = userStats.todayMessages || 0;

        if (todayMessages >= 100) return 'very_high';
        if (todayMessages >= 50) return 'high';
        if (todayMessages >= 20) return 'medium';
        if (todayMessages >= 5) return 'low';
        return 'minimal';
    }

    /**
     * 获取所有用户统计
     * @returns {Array} 用户统计数组
     */
    getAllUserLoadStats() {
        const allStats = [];
        const now = Date.now();

        // 只有当距离上次更新超过1分钟时才更新在线时长
        if (!this.lastDurationUpdate || (now - this.lastDurationUpdate) > 60000) {
            this.updateOnlineUsersDuration();
            this.lastDurationUpdate = now;
        }

        for (const [userHandle] of this.userLoadStats) {
            // 统计所有用户，不限制活跃时间
            const userStats = this.getUserLoadStats(userHandle);
            if (userStats) {
                allStats.push(userStats);
            }
        }

        // 按最新聊天时间排序（最近聊天的用户在前）
        return allStats.sort((a, b) => {
            // 如果有聊天时间，按聊天时间排序
            if (a.lastChatTime && b.lastChatTime) {
                return b.lastChatTime - a.lastChatTime;
            }
            // 如果只有一个有聊天时间，有聊天时间的排在前面
            if (a.lastChatTime && !b.lastChatTime) {
                return -1;
            }
            if (!a.lastChatTime && b.lastChatTime) {
                return 1;
            }
            // 如果都没有聊天时间，按最后会话时间排序
            return b.lastSessionTime - a.lastSessionTime;
        });
    }

    /**
     * 获取系统负载历史
     * @param {number} limit 限制返回的记录数
     * @returns {Array} 系统负载历史
     */
    getSystemLoadHistory(limit = 20) {
        return this.systemLoadHistory.slice(-limit);
    }

    /**
     * 确保数据目录存在
     */
    ensureDataDirectory() {
        try {
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
                console.log(`创建系统监控数据目录: ${this.dataDir}`);
            }
        } catch (error) {
            console.error('创建数据目录失败:', error);
        }
    }

    /**
     * 加载持久化数据
     */
    loadPersistedData() {
        try {
            // 加载用户统计数据
            if (fs.existsSync(this.userStatsFile)) {
                const userData = JSON.parse(fs.readFileSync(this.userStatsFile, 'utf8'));
                this.userLoadStats = new Map(Object.entries(userData));
                console.log(`加载用户统计数据: ${this.userLoadStats.size} 个用户`);
            }

            // 加载系统负载历史
            if (fs.existsSync(this.loadHistoryFile)) {
                const historyData = JSON.parse(fs.readFileSync(this.loadHistoryFile, 'utf8'));
                this.systemLoadHistory = historyData;
                console.log(`加载系统负载历史: ${this.systemLoadHistory.length} 条记录`);
            }

            // 加载系统统计信息
            if (fs.existsSync(this.systemStatsFile)) {
                const systemData = JSON.parse(fs.readFileSync(this.systemStatsFile, 'utf8'));
                if (systemData.startTime) {
                    this.startTime = systemData.startTime;
                }
                console.log(`加载系统统计信息，启动时间: ${new Date(this.startTime).toLocaleString()}`);
            }
        } catch (error) {
            console.error('加载持久化数据失败:', error);
        }
    }

    /**
     * 保存数据到磁盘
     */
    saveDataToDisk() {
        try {
            // 保存用户统计数据
            const userStatsObj = Object.fromEntries(this.userLoadStats);
            fs.writeFileSync(this.userStatsFile, JSON.stringify(userStatsObj, null, 2));

            // 保存系统负载历史（只保存最近的记录）
            const recentHistory = this.systemLoadHistory.slice(-this.maxHistoryLength);
            fs.writeFileSync(this.loadHistoryFile, JSON.stringify(recentHistory, null, 2));

            // 保存系统统计信息
            const systemStats = {
                startTime: this.startTime,
                lastSave: Date.now(),
            };
            fs.writeFileSync(this.systemStatsFile, JSON.stringify(systemStats, null, 2));

            if (process.env.NODE_ENV === 'development') {
                console.log(`数据已保存: 用户=${this.userLoadStats.size}, 历史=${recentHistory.length}`);
            }
        } catch (error) {
            console.error('保存数据失败:', error);
        }
    }

    /**
     * 重置特定用户的统计数据
     * @param {string} userHandle - 用户句柄
     */
    resetUserStats(userHandle) {
        if (this.userLoadStats.has(userHandle)) {
            this.userLoadStats.delete(userHandle);
            console.log(`用户 ${userHandle} 的统计数据已重置`);
        }
    }

    /**
     * 清除所有统计数据
     */
    clearAllStats() {
        this.userLoadStats.clear();
        this.systemLoadHistory = [];

        // 删除持久化文件
        try {
            [this.userStatsFile, this.loadHistoryFile, this.systemStatsFile].forEach(file => {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            });
            console.log('所有统计数据已清除');
        } catch (error) {
            console.error('清除数据文件失败:', error);
        }
    }

    /**
     * 销毁监控器
     */
    destroy() {
        // 保存数据
        this.saveDataToDisk();

        // 清理定时器
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        if (this.saveInterval) {
            clearInterval(this.saveInterval);
        }

        if (this.userUpdateInterval) {
            clearInterval(this.userUpdateInterval);
        }
    }
}

// 创建全局系统监控器实例
const systemMonitor = new SystemMonitor();

// 进程退出时保存数据
process.on('SIGINT', () => {
    console.log('\n正在保存系统监控数据...');
    systemMonitor.saveDataToDisk();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n正在保存系统监控数据...');
    systemMonitor.saveDataToDisk();
    process.exit(0);
});

process.on('beforeExit', () => {
    systemMonitor.saveDataToDisk();
});

export default systemMonitor;
export { SystemMonitor };
