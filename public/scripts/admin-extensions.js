// @ts-nocheck
// 管理员面板扩展功能
let systemLoadInterval;
let systemLoadAutoPaused = false;
let currentSystemData = null;
let currentInvitationCodes = [];
let csrfToken = null;

// 初始化管理员扩展功能
function initializeAdminExtensions() {
    // 获取CSRF token
    getCsrfToken().then(() => {
        // 绑定选项卡切换事件
        bindTabEvents();

        // 绑定系统负载相关事件
        bindSystemLoadEvents();

        // 绑定邀请码管理相关事件
        bindInvitationCodeEvents();

        // 绑定公告管理相关事件
        bindAnnouncementEvents();

        // 检查当前显示的选项卡并自动加载数据
        checkAndLoadCurrentTab();
    });
}

// 检查当前显示的选项卡并自动加载数据
function checkAndLoadCurrentTab() {
    setTimeout(() => {
        // 检查系统负载选项卡是否显示
        const systemLoadBlock = document.querySelector('.systemLoadBlock');
        if (systemLoadBlock && isElementVisible(systemLoadBlock)) {
            console.log('System load tab is visible, loading data...');
            loadSystemLoadData();
            startSystemLoadAutoRefresh();
        }

        // 检查邀请码管理选项卡是否显示
        const invitationCodesBlock = document.querySelector('.invitationCodesBlock');
        if (invitationCodesBlock && isElementVisible(invitationCodesBlock)) {
            console.log('Invitation codes tab is visible, loading data...');
            loadInvitationCodes();
        }

        // 检查公告管理选项卡是否显示
        const announcementsBlock = document.querySelector('.announcementsBlock');
        if (announcementsBlock && isElementVisible(announcementsBlock)) {
            console.log('Announcements tab is visible, loading data...');
            loadAnnouncements();
        }
    }, 100); // 稍微延迟以确保DOM完全渲染
}

// 检查元素是否可见
function isElementVisible(element) {
    if (!element) return false;

    // 检查display样式
    const style = window.getComputedStyle(element);
    if (style.display === 'none') return false;

    // 检查是否有offsetParent (更可靠的可见性检测)
    return element.offsetParent !== null;
}

// 绑定选项卡切换事件
function bindTabEvents() {
    // 系统负载选项卡
    const systemLoadButton = document.querySelector('.systemLoadButton');
    if (systemLoadButton) {
        systemLoadButton.addEventListener('click', function() {
            showSystemLoadTab();
        });
    }

    // 邀请码管理选项卡
    const invitationCodesButton = document.querySelector('.invitationCodesButton');
    if (invitationCodesButton) {
        invitationCodesButton.addEventListener('click', function() {
            showInvitationCodesTab();
        });
    }

    // 公告管理选项卡
    const announcementsButton = document.querySelector('.announcementsButton');
    if (announcementsButton) {
        announcementsButton.addEventListener('click', function() {
            showAnnouncementsTab();
        });
    }

    // 邮件配置选项卡
    const emailConfigButton = document.querySelector('.emailConfigButton');
    if (emailConfigButton) {
        emailConfigButton.addEventListener('click', function() {
            showEmailConfigTab();
        });
    }
}

// 显示系统负载选项卡
function showSystemLoadTab() {
    // 隐藏其他选项卡
    hideAllTabs();

    // 重置分页和搜索状态
    currentUserPage = 1;
    userSearchTerm = '';

    // 显示系统负载选项卡
    const systemLoadBlock = document.querySelector('.systemLoadBlock');
    if (systemLoadBlock) {
        systemLoadBlock.style.display = 'block';
        // 立即加载数据
        loadSystemLoadData();
        // 启动自动刷新
        startSystemLoadAutoRefresh();
    }
}

// 显示邀请码管理选项卡
function showInvitationCodesTab() {
    // 隐藏其他选项卡
    hideAllTabs();

    // 重置分页状态
    currentCodePage = 1;
    codeSearchTerm = '';

    // 显示邀请码管理选项卡
    const invitationCodesBlock = document.querySelector('.invitationCodesBlock');
    if (invitationCodesBlock) {
        invitationCodesBlock.style.display = 'block';
        loadInvitationCodes();
    }
}

// 显示公告管理选项卡
function showAnnouncementsTab() {
    // 隐藏其他选项卡
    hideAllTabs();

    // 显示公告管理选项卡
    const announcementsBlock = document.querySelector('.announcementsBlock');
    if (announcementsBlock) {
        announcementsBlock.style.display = 'block';
        bindAnnouncementEvents(); // 重新绑定事件
        loadAnnouncements();
    }
}

// 显示邮件配置选项卡
function showEmailConfigTab() {
    // 隐藏其他选项卡
    hideAllTabs();

    // 显示邮件配置选项卡
    const emailConfigBlock = document.querySelector('.emailConfigBlock');
    if (emailConfigBlock) {
        emailConfigBlock.style.display = 'block';
        loadEmailConfig(); // 加载邮件配置
    }
}

// 隐藏所有选项卡
function hideAllTabs() {
    // 停止系统负载自动刷新
    stopSystemLoadAutoRefresh();

    const tabs = document.querySelectorAll('.navTab');
    tabs.forEach(tab => {
        tab.style.display = 'none';
    });
}

// 系统负载相关功能
function bindSystemLoadEvents() {
    // 刷新系统负载按钮
    const refreshButton = document.getElementById('refreshSystemLoad');
    if (refreshButton) {
        refreshButton.addEventListener('click', function() {
            loadSystemLoadData();
        });
    }

    // 清除统计数据按钮
    const clearStatsButton = document.getElementById('clearSystemStats');
    if (clearStatsButton) {
        clearStatsButton.addEventListener('click', function() {
            clearSystemStats();
        });
    }

	// 鼠标悬停用户统计区域时暂停自动刷新，便于查看
	const userActivityList = document.getElementById('userActivityList');
	if (userActivityList) {
		userActivityList.addEventListener('mouseenter', function() {
			pauseSystemLoadAutoRefresh();
		});
		userActivityList.addEventListener('mouseleave', function() {
			resumeSystemLoadAutoRefresh();
		});
	}

	// 页面不可见时暂停，返回时恢复
	document.addEventListener('visibilitychange', function() {
		if (document.hidden) {
			pauseSystemLoadAutoRefresh();
		} else {
			resumeSystemLoadAutoRefresh();
		}
	});
}

// 加载系统负载数据
async function loadSystemLoadData() {
    try {
        showLoadingState('userActivityList');

        const response = await fetch('/api/system-load/', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to load system data');
        }

        currentSystemData = await response.json();
        renderSystemLoadData();

    } catch (error) {
        console.error('Error loading system load data:', error);
        showErrorState('userActivityList', '加载系统数据失败');
    }
}

// 渲染系统负载数据
function renderSystemLoadData() {
    if (!currentSystemData) return;

    // 更新系统概览
    updateSystemOverview(currentSystemData.system);

    // 更新用户活动统计
    updateUserActivity(currentSystemData.users);
}

// 更新系统概览
function updateSystemOverview(systemData) {
    // CPU 使用率
    const cpuUsage = document.getElementById('cpuUsage');
    const cpuProgress = document.getElementById('cpuProgress');
    if (cpuUsage && cpuProgress && systemData.cpu) {
        const cpuPercent = Math.round(systemData.cpu.percent || 0);
        cpuUsage.textContent = cpuPercent;
        cpuProgress.style.width = `${cpuPercent}%`;

        // 根据使用率设置颜色
        if (cpuPercent > 80) {
            cpuProgress.style.background = 'linear-gradient(90deg, #ff6b6b 0%, #ee5a24 100%)';
        } else if (cpuPercent > 60) {
            cpuProgress.style.background = 'linear-gradient(90deg, #feca57 0%, #ff9ff3 100%)';
        } else {
            cpuProgress.style.background = 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)';
        }
    }

    // 内存使用
    const memoryUsage = document.getElementById('memoryUsage');
    const memoryProgress = document.getElementById('memoryProgress');
    if (memoryUsage && memoryProgress && systemData.memory) {
        const memoryPercent = Math.round(systemData.memory.percent || 0);
        memoryUsage.textContent = memoryPercent;
        memoryProgress.style.width = `${memoryPercent}%`;

        // 根据使用率设置颜色
        if (memoryPercent > 80) {
            memoryProgress.style.background = 'linear-gradient(90deg, #ff6b6b 0%, #ee5a24 100%)';
        } else if (memoryPercent > 60) {
            memoryProgress.style.background = 'linear-gradient(90deg, #feca57 0%, #ff9ff3 100%)';
        } else {
            memoryProgress.style.background = 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)';
        }
    }

    // 活跃用户数
    const activeUsers = document.getElementById('activeUsers');
    if (activeUsers) {
        activeUsers.textContent = currentSystemData.users ? currentSystemData.users.length : 0;
    }

    // 运行时间
    const uptime = document.getElementById('uptime');
    if (uptime && systemData.uptime) {
        uptime.textContent = systemData.uptime.processFormatted || '--';
    }
}

// 用户活动分页相关
let currentUserPage = 1;
const usersPerPage = 20; // 每页显示20个用户
let filteredUsers = [];
let userSearchTerm = '';

// 更新用户统计
function updateUserActivity(usersData) {
    const userActivityList = document.getElementById('userActivityList');
    if (!userActivityList) return;

    if (!usersData || usersData.length === 0) {
        userActivityList.innerHTML = createEmptyState('fa-users', '暂无用户数据', '没有用户统计数据');
        return;
    }

    // 应用搜索过滤
    filteredUsers = userSearchTerm ? usersData.filter(user =>
        (user.userName && user.userName.toLowerCase().includes(userSearchTerm.toLowerCase())) ||
        (user.userHandle && user.userHandle.toLowerCase().includes(userSearchTerm.toLowerCase()))
    ) : usersData;

    // 计算分页
    const totalPages = Math.ceil(filteredUsers.length / usersPerPage);
    const startIndex = (currentUserPage - 1) * usersPerPage;
    const endIndex = startIndex + usersPerPage;
    const pageUsers = filteredUsers.slice(startIndex, endIndex);

    // 渲染用户列表
    const userActivityHtml = pageUsers.map(user => createUserActivityItem(user)).join('');

    // 创建分页控件
    const paginationHtml = createPaginationControls(currentUserPage, totalPages, filteredUsers.length);

    userActivityList.innerHTML = `
        <div class="userActivityControls">
            <input type="text" id="userSearchInput" placeholder="搜索用户名或句柄..."
                   value="${userSearchTerm}" class="text_pole" style="flex: 1; margin-right: 10px;">
            <span class="userCount" style="white-space: nowrap; opacity: 0.7;">
                显示 ${startIndex + 1}-${Math.min(endIndex, filteredUsers.length)} / ${filteredUsers.length} 用户
            </span>
        </div>
        ${paginationHtml}
        <div class="userActivityListContent">${userActivityHtml}</div>
        ${paginationHtml}
    `;

    // 绑定搜索事件
    const searchInput = document.getElementById('userSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounceSearch(function(e) {
            userSearchTerm = e.target.value.trim();
            currentUserPage = 1; // 重置到第一页
            updateUserActivity(currentSystemData.users);
        }, 300));
    }

    // 绑定分页按钮事件
    bindPaginationEvents();
}

// 创建分页控件
function createPaginationControls(currentPage, totalPages, totalUsers) {
    if (totalPages <= 1) return '';

    let html = '<div class="paginationControls" style="display: flex; align-items: center; justify-content: center; gap: 10px; margin: 15px 0;">';

    // 上一页按钮
    if (currentPage > 1) {
        html += `<button class="menu_button pagination-btn" data-page="${currentPage - 1}">
            <i class="fa-solid fa-chevron-left"></i> 上一页
        </button>`;
    } else {
        html += `<button class="menu_button" disabled style="opacity: 0.5;">
            <i class="fa-solid fa-chevron-left"></i> 上一页
        </button>`;
    }

    // 页码按钮
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);

    // 调整起始页
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }

    // 第一页
    if (startPage > 1) {
        html += `<button class="menu_button pagination-btn" data-page="1">1</button>`;
        if (startPage > 2) {
            html += `<span style="opacity: 0.5;">...</span>`;
        }
    }

    // 中间页码
    for (let i = startPage; i <= endPage; i++) {
        if (i === currentPage) {
            html += `<button class="menu_button" disabled style="background: var(--SmartThemeBlurTintColor);">${i}</button>`;
        } else {
            html += `<button class="menu_button pagination-btn" data-page="${i}">${i}</button>`;
        }
    }

    // 最后一页
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            html += `<span style="opacity: 0.5;">...</span>`;
        }
        html += `<button class="menu_button pagination-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    // 下一页按钮
    if (currentPage < totalPages) {
        html += `<button class="menu_button pagination-btn" data-page="${currentPage + 1}">
            下一页 <i class="fa-solid fa-chevron-right"></i>
        </button>`;
    } else {
        html += `<button class="menu_button" disabled style="opacity: 0.5;">
            下一页 <i class="fa-solid fa-chevron-right"></i>
        </button>`;
    }

    html += '</div>';
    return html;
}

// 绑定分页按钮事件
function bindPaginationEvents() {
    const paginationBtns = document.querySelectorAll('.pagination-btn');
    paginationBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            currentUserPage = parseInt(this.dataset.page);
            updateUserActivity(currentSystemData.users);

            // 滚动到顶部
            const userActivityList = document.getElementById('userActivityList');
            if (userActivityList) {
                userActivityList.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

// 防抖函数
function debounceSearch(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 创建用户统计项目
function createUserActivityItem(user) {
    // 使用新的在线状态文本和颜色逻辑
    const onlineStatus = user.onlineStatusText || (user.isOnline ? '在线' : '离线');
    let statusColor = '#95a5a6'; // 默认离线颜色

    if (user.isOnline) {
        if (user.onlineStatusText === '在线') {
            statusColor = '#27ae60'; // 绿色 - 真正在线
        } else if (user.onlineStatusText === '可能离线') {
            statusColor = '#f39c12'; // 橙色 - 可能离线
        } else {
            statusColor = '#3498db'; // 蓝色 - 在线但无心跳
        }
    }

    return `
        <div class="userActivityItem">
            <div class="userActivityInfo">
                <div class="userActivityName">${escapeHtml(user.userName || user.userHandle)}</div>
                <div class="userActivityHandle">
                    <span style="color: ${statusColor}; font-weight: bold;">${onlineStatus}</span>
                    <span style="color: #666; margin-left: 10px;">${user.userHandle}</span>
                </div>
                <div class="userActivityDetails">
                    <div class="userActivityDetail">最后聊天: ${user.lastChatTimeFormatted}</div>
                    <div class="userActivityDetail">最后会话: ${user.lastSessionTimeFormatted}</div>
                    ${user.onlineDurationFormatted ? `<div class="userActivityDetail">在线时长: ${user.onlineDurationFormatted}</div>` : ''}
                    ${user.lastHeartbeatFormatted && user.lastHeartbeatFormatted !== '无' ? `<div class="userActivityDetail">最后心跳: ${user.lastHeartbeatFormatted}</div>` : ''}
                </div>
            </div>
            <div class="userActivityStats">
                <div class="userActivityStat">
                    <div class="userActivityStatValue">${user.totalMessages || 0}</div>
                    <div class="userActivityStatLabel">总消息</div>
                </div>
                <div class="userActivityStat">
                    <div class="userActivityStatValue">${user.todayMessages || 0}</div>
                    <div class="userActivityStatLabel">今日消息</div>
                </div>
                <div class="userActivityStat">
                    <div class="userActivityStatValue">${user.sessionCount || 0}</div>
                    <div class="userActivityStatLabel">会话次数</div>
                </div>
            </div>
        </div>
    `;
}

// 获取活动等级文本
function getActivityLevelText(level) {
    const levelMap = {
        'very_high': '非常活跃',
        'high': '高度活跃',
        'medium': '中等活跃',
        'low': '低度活跃',
        'minimal': '轻度活跃'
    };
    return levelMap[level] || '未知';
}

// 获取活动等级颜色
function getActivityLevelColor(level) {
    const colorMap = {
        'very_high': '#e74c3c',
        'high': '#e67e22',
        'medium': '#f39c12',
        'low': '#27ae60',
        'minimal': '#95a5a6'
    };
    return colorMap[level] || '#666';
}

// 开始系统负载自动刷新
function startSystemLoadAutoRefresh() {
    stopSystemLoadAutoRefresh();
    systemLoadInterval = setInterval(() => {
        if (!systemLoadAutoPaused) {
            loadSystemLoadData();
        }
    }, 60000); // 每60秒刷新一次
}

// 停止系统负载自动刷新
function stopSystemLoadAutoRefresh() {
    if (systemLoadInterval) {
        clearInterval(systemLoadInterval);
        systemLoadInterval = null;
    }
}

// 暂停/恢复自动刷新（不销毁现有间隔，仅设置暂停标记）
function pauseSystemLoadAutoRefresh() {
    systemLoadAutoPaused = true;
}

function resumeSystemLoadAutoRefresh() {
    systemLoadAutoPaused = false;
}

// 清除系统统计数据
async function clearSystemStats() {
    if (!confirm('确定要清除所有系统统计数据吗？此操作不可恢复。')) {
        return;
    }

    try {
        const response = await fetch('/api/system-load/clear', {
            method: 'POST',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to clear system stats');
        }

        alert('系统统计数据已清除');
        loadSystemLoadData();

    } catch (error) {
        console.error('Error clearing system stats:', error);
        alert('清除统计数据失败');
    }
}

// 邀请码分页相关
let currentCodePage = 1;
const codesPerPage = 50; // 每页显示50个邀请码
let codeSearchTerm = '';

// 邀请码管理相关功能
function bindInvitationCodeEvents() {
    // 购买链接表单
    bindPurchaseLinkForm();

    // 加载购买链接
    loadPurchaseLink();

    // 创建模式切换
    bindCreationModeToggle();

    // 创建邀请码表单 - 移除之前的事件监听器以防重复绑定
    const createInvitationForm = document.querySelector('.createInvitationForm');
    if (createInvitationForm) {
        // 克隆节点来移除所有事件监听器
        const newForm = createInvitationForm.cloneNode(true);
        createInvitationForm.parentNode.replaceChild(newForm, createInvitationForm);

        newForm.addEventListener('submit', function(e) {
            e.preventDefault();
            createInvitationCode();
        });
    }

    // 批量创建邀请码表单 - 移除之前的事件监听器以防重复绑定
    const createBatchInvitationForm = document.querySelector('.createBatchInvitationForm');
    if (createBatchInvitationForm) {
        // 克隆节点来移除所有事件监听器
        const newBatchForm = createBatchInvitationForm.cloneNode(true);
        createBatchInvitationForm.parentNode.replaceChild(newBatchForm, createBatchInvitationForm);

        newBatchForm.addEventListener('submit', function(e) {
            e.preventDefault();
            createBatchInvitationCodes();
        });
    }

    // 刷新邀请码列表按钮
    const refreshInvitationCodes = document.getElementById('refreshInvitationCodes');
    if (refreshInvitationCodes) {
        refreshInvitationCodes.addEventListener('click', function() {
            loadInvitationCodes();
        });
    }

    // 清理过期邀请码按钮
    const cleanupExpiredCodes = document.getElementById('cleanupExpiredCodes');
    if (cleanupExpiredCodes) {
        cleanupExpiredCodes.addEventListener('click', function() {
            cleanupExpiredInvitationCodes();
        });
    }

    // 筛选器事件
    const typeFilter = document.getElementById('invitationTypeFilter');
    const statusFilter = document.getElementById('invitationStatusFilter');
    if (typeFilter) {
        typeFilter.addEventListener('change', function() {
            renderInvitationCodes();
        });
    }
    if (statusFilter) {
        statusFilter.addEventListener('change', function() {
            renderInvitationCodes();
        });
    }

    // 批量操作按钮
    bindBatchOperationEvents();
}

// 绑定购买链接表单
function bindPurchaseLinkForm() {
    const purchaseLinkForm = document.querySelector('.purchaseLinkForm');
    if (purchaseLinkForm) {
        const newForm = purchaseLinkForm.cloneNode(true);
        purchaseLinkForm.parentNode.replaceChild(newForm, purchaseLinkForm);

        newForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            await savePurchaseLink();
        });
    }
}

// 加载购买链接
async function loadPurchaseLink() {
    try {
        const response = await fetch('/api/invitation-codes/purchase-link', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (response.ok) {
            const data = await response.json();
            const input = document.getElementById('purchaseLinkInput');
            if (input) {
                input.value = data.purchaseLink || '';
            }
        }
    } catch (error) {
        console.error('Error loading purchase link:', error);
    }
}

// 保存购买链接
async function savePurchaseLink() {
    const input = document.getElementById('purchaseLinkInput');
    const statusDiv = document.querySelector('.purchaseLinkStatus');

    if (!input || !statusDiv) return;

    const purchaseLink = input.value.trim();

    try {
        const response = await fetch('/api/invitation-codes/purchase-link', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ purchaseLink })
        });

        if (!response.ok) {
            throw new Error('保存失败');
        }

        statusDiv.textContent = '✓ 购买链接已保存';
        statusDiv.style.color = 'green';
        statusDiv.style.display = 'block';

        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);
    } catch (error) {
        console.error('Error saving purchase link:', error);
        statusDiv.textContent = '✗ 保存失败：' + error.message;
        statusDiv.style.color = 'red';
        statusDiv.style.display = 'block';
    }
}

// 绑定创建模式切换
function bindCreationModeToggle() {
    const toggleButtons = document.querySelectorAll('.creation-toggle-btn');
    toggleButtons.forEach(button => {
        button.addEventListener('click', function() {
            const mode = this.dataset.mode;
            switchCreationMode(mode);
        });
    });
}

// 切换创建模式
function switchCreationMode(mode) {
    // 更新按钮状态
    const toggleButtons = document.querySelectorAll('.creation-toggle-btn');
    toggleButtons.forEach(btn => {
        if (btn.dataset.mode === mode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // 切换表单显示
    const singleMode = document.getElementById('singleCreationMode');
    const batchMode = document.getElementById('batchCreationMode');

    if (mode === 'single') {
        singleMode.style.display = 'block';
        batchMode.style.display = 'none';
    } else {
        singleMode.style.display = 'none';
        batchMode.style.display = 'block';
    }
}

// 绑定批量操作事件
function bindBatchOperationEvents() {
    // 全选/取消全选
    const selectAllBtn = document.getElementById('selectAllCodes');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', toggleSelectAll);
    }

    // 下载选中
    const downloadSelectedBtn = document.getElementById('downloadSelectedCodes');
    if (downloadSelectedBtn) {
        downloadSelectedBtn.addEventListener('click', downloadSelectedCodes);
    }

    // 下载全部
    const downloadAllBtn = document.getElementById('downloadAllCodes');
    if (downloadAllBtn) {
        downloadAllBtn.addEventListener('click', downloadAllCodes);
    }

    // 删除选中
    const deleteSelectedBtn = document.getElementById('deleteSelectedCodes');
    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', deleteSelectedCodes);
    }
}

// 加载邀请码列表
async function loadInvitationCodes() {
    try {
        showLoadingState('invitationCodesContainer');

        const response = await fetch('/api/invitation-codes/', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to load invitation codes');
        }

        const data = await response.json();
        // 过滤掉无效的邀请码（code为undefined、null或空字符串）
        currentInvitationCodes = (data.codes || []).filter(code => code && code.code && typeof code.code === 'string');

        // 如果发现有无效数据，提示用户
        const totalCodes = data.codes ? data.codes.length : 0;
        if (totalCodes > currentInvitationCodes.length) {
            console.warn(`发现 ${totalCodes - currentInvitationCodes.length} 个无效邀请码已被过滤`);
        }

        renderInvitationCodes();

    } catch (error) {
        console.error('Error loading invitation codes:', error);
        showErrorState('invitationCodesContainer', '加载邀请码失败');
    }
}

// 渲染邀请码列表
function renderInvitationCodes() {
    const container = document.getElementById('invitationCodesContainer');
    if (!container) return;

    if (currentInvitationCodes.length === 0) {
        container.innerHTML = createEmptyState('fa-ticket', '暂无邀请码', '点击上方按钮创建新的邀请码');
        return;
    }

    // 获取筛选条件
    const typeFilter = document.getElementById('invitationTypeFilter');
    const statusFilter = document.getElementById('invitationStatusFilter');
    const selectedType = typeFilter ? typeFilter.value : 'all';
    const selectedStatus = statusFilter ? statusFilter.value : 'all';

    // 筛选邀请码（同时再次过滤无效数据）
    let filteredCodes = currentInvitationCodes.filter(code => code && code.code && typeof code.code === 'string');

    // 按类型筛选
    if (selectedType !== 'all') {
        filteredCodes = filteredCodes.filter(code => code.durationType === selectedType);
    }

    // 按状态筛选
    if (selectedStatus !== 'all') {
        if (selectedStatus === 'used') {
            filteredCodes = filteredCodes.filter(code => code.used === true);
        } else if (selectedStatus === 'unused') {
            filteredCodes = filteredCodes.filter(code => code.used === false);
        }
    }

    // 按搜索词筛选
    if (codeSearchTerm) {
        filteredCodes = filteredCodes.filter(code =>
            code.code.toLowerCase().includes(codeSearchTerm.toLowerCase()) ||
            (code.createdBy && code.createdBy.toLowerCase().includes(codeSearchTerm.toLowerCase())) ||
            (code.usedBy && code.usedBy.toLowerCase().includes(codeSearchTerm.toLowerCase()))
        );
    }

    // 显示筛选结果
    if (filteredCodes.length === 0) {
        container.innerHTML = createEmptyState('fa-filter', '没有符合条件的邀请码', '请调整筛选条件或搜索词');
        return;
    }

    // 计算分页
    const totalPages = Math.ceil(filteredCodes.length / codesPerPage);

    // 如果当前页超出范围，自动调整到最后一页
    if (currentCodePage > totalPages) {
        currentCodePage = Math.max(1, totalPages);
    }

    const startIndex = (currentCodePage - 1) * codesPerPage;
    const endIndex = startIndex + codesPerPage;
    const pageCodes = filteredCodes.slice(startIndex, endIndex);

    // 创建搜索框和统计信息
    const controlsHtml = `
        <div class="invitationCodeControls" style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px; padding: 10px; background: var(--SmartThemeBlurTintColor); border-radius: 10px;">
            <input type="text" id="codeSearchInput" placeholder="搜索邀请码、创建者或使用者..."
                   value="${escapeHtml(codeSearchTerm)}" class="text_pole" style="flex: 1;">
            <span class="codeCount" style="white-space: nowrap; opacity: 0.7; font-size: 0.9em; padding: 5px 10px; background: var(--black30a); border-radius: 5px;">
                显示 ${startIndex + 1}-${Math.min(endIndex, filteredCodes.length)} / ${filteredCodes.length} 个邀请码
            </span>
        </div>
    `;

    // 创建分页控件
    const paginationHtml = createCodePaginationControls(currentCodePage, totalPages, filteredCodes.length);

    // 渲染邀请码列表
    const codesHtml = pageCodes.map(code => createInvitationCodeItem(code)).join('');

    container.innerHTML = `
        ${controlsHtml}
        ${paginationHtml}
        <div class="invitationCodeListContent" style="display: flex; flex-direction: column; gap: 10px;">
            ${codesHtml}
        </div>
        ${paginationHtml}
    `;

    // 绑定搜索事件
    const searchInput = document.getElementById('codeSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounceSearch(function(e) {
            codeSearchTerm = e.target.value.trim();
            currentCodePage = 1; // 重置到第一页
            renderInvitationCodes();
        }, 300));
    }

    // 绑定删除按钮事件
    bindInvitationCodeDeleteEvents();

    // 绑定分页按钮事件
    bindCodePaginationEvents();

    // 更新全选按钮状态
    updateSelectAllButton();
}

// 创建邀请码分页控件
function createCodePaginationControls(currentPage, totalPages, totalCodes) {
    if (totalPages <= 1) return '';

    let html = '<div class="paginationControls" style="display: flex; align-items: center; justify-content: center; gap: 10px; margin: 15px 0; flex-wrap: wrap;">';

    // 上一页按钮
    if (currentPage > 1) {
        html += `<button class="menu_button code-pagination-btn" data-page="${currentPage - 1}">
            <i class="fa-solid fa-chevron-left"></i> 上一页
        </button>`;
    } else {
        html += `<button class="menu_button" disabled style="opacity: 0.5;">
            <i class="fa-solid fa-chevron-left"></i> 上一页
        </button>`;
    }

    // 页码按钮
    const maxButtons = 7;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);

    // 调整起始页
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }

    // 第一页
    if (startPage > 1) {
        html += `<button class="menu_button code-pagination-btn" data-page="1">1</button>`;
        if (startPage > 2) {
            html += `<span style="opacity: 0.5;">...</span>`;
        }
    }

    // 中间页码
    for (let i = startPage; i <= endPage; i++) {
        if (i === currentPage) {
            html += `<button class="menu_button" disabled style="background: var(--SmartThemeBlurTintColor);">${i}</button>`;
        } else {
            html += `<button class="menu_button code-pagination-btn" data-page="${i}">${i}</button>`;
        }
    }

    // 最后一页
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            html += `<span style="opacity: 0.5;">...</span>`;
        }
        html += `<button class="menu_button code-pagination-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    // 下一页按钮
    if (currentPage < totalPages) {
        html += `<button class="menu_button code-pagination-btn" data-page="${currentPage + 1}">
            下一页 <i class="fa-solid fa-chevron-right"></i>
        </button>`;
    } else {
        html += `<button class="menu_button" disabled style="opacity: 0.5;">
            下一页 <i class="fa-solid fa-chevron-right"></i>
        </button>`;
    }

    html += '</div>';
    return html;
}

// 绑定邀请码分页按钮事件
function bindCodePaginationEvents() {
    const paginationBtns = document.querySelectorAll('.code-pagination-btn');
    paginationBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            currentCodePage = parseInt(this.dataset.page);
            renderInvitationCodes();

            // 滚动到顶部
            const container = document.getElementById('invitationCodesContainer');
            if (container) {
                container.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

// 创建邀请码项目
function createInvitationCodeItem(code) {
    const status = getInvitationCodeStatus(code);
    const statusClass = status.class;
    const statusText = status.text;
    const createdDate = new Date(code.createdAt).toLocaleString('zh-CN');

    // 类型映射
    const durationTypeText = {
        '1day': '1天',
        '1week': '1周',
        '1month': '1个月',
        '1quarter': '1季度',
        '6months': '半年',
        '1year': '1年',
        'permanent': '永久'
    }[code.durationType] || code.durationType || '未知';

    // 用户到期时间（仅在已使用时显示）
    let userExpiresText = '';
    if (code.used && code.userExpiresAt) {
        userExpiresText = new Date(code.userExpiresAt).toLocaleString('zh-CN');
    } else if (code.used && !code.userExpiresAt) {
        userExpiresText = '永久';
    }

    // 确保字段不为 undefined
    const createdBy = code.createdBy || '未知';
    const usedBy = code.usedBy || '未知';

    return `
        <div class="invitationCodeItem" data-code="${code.code}">
            <input type="checkbox" class="invitationCodeCheckbox" data-code="${code.code}" onchange="toggleCodeSelection('${code.code}')">
            <div class="invitationCodeInfo">
                <div class="invitationCodeValue" title="点击复制" onclick="copyToClipboard('${code.code}')">${code.code}</div>
                <div class="invitationCodeMeta">
                    <span>创建者: ${escapeHtml(createdBy)}</span>
                    <span>创建时间: ${createdDate}</span>
                    <span>类型: ${durationTypeText}</span>
                    ${code.used ? `<span>使用者: ${escapeHtml(usedBy)}</span>` : ''}
                    ${code.used ? `<span>使用时间: ${new Date(code.usedAt).toLocaleString('zh-CN')}</span>` : ''}
                    ${code.used && userExpiresText ? `<span>用户到期: ${userExpiresText}</span>` : ''}
                </div>
            </div>
            <div class="invitationCodeActions">
                <span class="invitationCodeStatus ${statusClass}">${statusText}</span>
                <button class="menu_button warning" onclick="deleteInvitationCode('${code.code}')" title="删除邀请码">
                    <i class="fa-fw fa-solid fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

// 获取邀请码状态
function getInvitationCodeStatus(code) {
    if (code.used) {
        return { class: 'used', text: '已使用' };
    }

    // 邀请码永不过期，只有已使用和未使用两种状态
    return { class: 'unused', text: '未使用' };
}

// 创建邀请码
async function createInvitationCode() {
    const form = document.querySelector('.createInvitationForm');
    const submitButton = form.querySelector('button[type="submit"]');

    // 防止重复提交
    if (submitButton.disabled) {
        return;
    }

    const durationType = form.querySelector('select[name="durationType"]').value;

    const requestData = {
        durationType: durationType || 'permanent'
    };

    // 禁用提交按钮防止重复提交
    submitButton.disabled = true;
    const originalText = submitButton.innerHTML;
    submitButton.innerHTML = '<i class="fa-fw fa-solid fa-spinner fa-spin"></i><span>创建中...</span>';

    try {
        const response = await fetch('/api/invitation-codes/create', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '创建邀请码失败');
        }

        const newCode = await response.json();
        const durationText = {
            '1day': '1天',
            '1week': '1周',
            '1month': '1个月',
            '1quarter': '1季度',
            '6months': '半年',
            '1year': '1年',
            'permanent': '永久'
        }[durationType] || '未知';
        alert(`邀请码创建成功：${newCode.code}\n有效期类型：${durationText}`);

        // 清空表单
        form.reset();

        // 重置到第一页显示新创建的邀请码
        currentCodePage = 1;

        // 重新加载邀请码列表
        loadInvitationCodes();

    } catch (error) {
        console.error('Error creating invitation code:', error);
        alert(error.message || '创建邀请码失败');
    } finally {
        // 恢复提交按钮
        submitButton.disabled = false;
        submitButton.innerHTML = originalText;
    }
}

// 删除邀请码
async function deleteInvitationCode(code) {
    if (!confirm(`确定要删除邀请码 ${code} 吗？`)) {
        return;
    }

    try {
        const response = await fetch(`/api/invitation-codes/${code}`, {
            method: 'DELETE',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '删除邀请码失败');
        }

        alert('邀请码删除成功');
        loadInvitationCodes();

    } catch (error) {
        console.error('Error deleting invitation code:', error);
        alert(error.message || '删除邀请码失败');
    }
}

// 批量创建邀请码
async function createBatchInvitationCodes() {
    const form = document.querySelector('.createBatchInvitationForm');
    const submitButton = form.querySelector('button[type="submit"]');

    // 防止重复提交
    if (submitButton.disabled) {
        return;
    }

    const count = parseInt(form.querySelector('input[name="batchCount"]').value);
    const durationType = form.querySelector('select[name="batchDurationType"]').value;

    if (!count || count < 1 || count > 100) {
        alert('数量必须在1-100之间');
        return;
    }

    const requestData = {
        count,
        durationType: durationType || 'permanent'
    };

    // 禁用提交按钮防止重复提交
    submitButton.disabled = true;
    const originalText = submitButton.innerHTML;
    submitButton.innerHTML = '<i class="fa-fw fa-solid fa-spinner fa-spin"></i><span>创建中...</span>';

    try {
        const response = await fetch('/api/invitation-codes/batch-create', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '批量创建邀请码失败');
        }

        const result = await response.json();
        const durationText = {
            '1day': '1天',
            '1week': '1周',
            '1month': '1个月',
            '1quarter': '1季度',
            '6months': '半年',
            '1year': '1年',
            'permanent': '永久'
        }[durationType] || '未知';
        alert(`成功创建了 ${result.count} 个邀请码\n有效期类型：${durationText}`);

        // 清空表单
        form.reset();
        form.querySelector('input[name="batchCount"]').value = '10';

        // 重置到第一页显示新创建的邀请码
        currentCodePage = 1;

        // 重新加载邀请码列表
        loadInvitationCodes();

    } catch (error) {
        console.error('Error batch creating invitation codes:', error);
        alert(error.message || '批量创建邀请码失败');
    } finally {
        // 恢复提交按钮
        submitButton.disabled = false;
        submitButton.innerHTML = originalText;
    }
}

// 切换代码选择状态
function toggleCodeSelection(code) {
    const item = document.querySelector(`[data-code="${code}"]`);
    const checkbox = document.querySelector(`input[data-code="${code}"]`);

    if (checkbox.checked) {
        item.classList.add('selected');
    } else {
        item.classList.remove('selected');
    }

    updateSelectAllButton();
}

// 全选/取消全选
function toggleSelectAll() {
    const checkboxes = document.querySelectorAll('.invitationCodeCheckbox');
    const selectAllBtn = document.getElementById('selectAllCodes');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);

    checkboxes.forEach(checkbox => {
        checkbox.checked = !allChecked;
        const code = checkbox.dataset.code;
        const item = document.querySelector(`[data-code="${code}"]`);

        if (checkbox.checked) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });

    updateSelectAllButton();
}

// 更新全选按钮状态
function updateSelectAllButton() {
    const checkboxes = document.querySelectorAll('.invitationCodeCheckbox');
    const selectAllBtn = document.getElementById('selectAllCodes');

    if (!selectAllBtn || checkboxes.length === 0) return;

    const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
    const allChecked = checkedCount === checkboxes.length;

    if (allChecked) {
        selectAllBtn.innerHTML = '<i class="fa-fw fa-solid fa-square"></i><span>取消全选</span>';
    } else {
        selectAllBtn.innerHTML = '<i class="fa-fw fa-solid fa-check-square"></i><span>全选</span>';
    }
}

// 获取选中的邀请码
function getSelectedCodes() {
    const selectedCheckboxes = document.querySelectorAll('.invitationCodeCheckbox:checked');
    return Array.from(selectedCheckboxes).map(cb => cb.dataset.code);
}

// 下载选中的邀请码
function downloadSelectedCodes() {
    const selectedCodes = getSelectedCodes();

    if (selectedCodes.length === 0) {
        alert('请先选择要下载的邀请码');
        return;
    }

    // 获取完整的邀请码对象
    const selectedCodeObjects = currentInvitationCodes.filter(code => selectedCodes.includes(code.code));
    downloadCodes(selectedCodeObjects, '选中的邀请码');
}

// 下载全部邀请码
function downloadAllCodes() {
    if (currentInvitationCodes.length === 0) {
        alert('没有邀请码可下载');
        return;
    }

    // 获取当前显示的邀请码（考虑筛选）
    const typeFilter = document.getElementById('invitationTypeFilter');
    const statusFilter = document.getElementById('invitationStatusFilter');
    const selectedType = typeFilter ? typeFilter.value : 'all';
    const selectedStatus = statusFilter ? statusFilter.value : 'all';

    let filteredCodes = currentInvitationCodes;

    // 按类型筛选
    if (selectedType !== 'all') {
        filteredCodes = filteredCodes.filter(code => code.durationType === selectedType);
    }

    // 按状态筛选
    if (selectedStatus !== 'all') {
        if (selectedStatus === 'used') {
            filteredCodes = filteredCodes.filter(code => code.used === true);
        } else if (selectedStatus === 'unused') {
            filteredCodes = filteredCodes.filter(code => code.used === false);
        }
    }

    if (filteredCodes.length === 0) {
        alert('没有符合条件的邀请码可下载');
        return;
    }

    downloadCodes(filteredCodes, '全部邀请码');
}

// 下载邀请码文件
function downloadCodes(codeObjects, filename) {
    // 类型映射
    const durationTypeText = {
        '1day': '1天',
        '1week': '1周',
        '1month': '1个月',
        '1quarter': '1季度',
        '6months': '半年',
        '1year': '1年',
        'permanent': '永久'
    };

    // 创建文本内容（包含类型提示）
    const lines = codeObjects.map(codeObj => {
        const typeText = durationTypeText[codeObj.durationType] || codeObj.durationType || '未知';
        const statusText = codeObj.used ? '已使用' : '未使用';
        return `${codeObj.code} - 类型:${typeText} - 状态:${statusText}`;
    });

    const textContent = lines.join('\n');

    // 生成文件名
    const timestamp = new Date().toISOString().slice(0, 10);
    const finalFilename = `${filename}_${timestamp}.txt`;

    // 下载TXT文件
    downloadFile(textContent, finalFilename, 'text/plain');
}

// 下载文件辅助函数
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType + ';charset=utf-8;' });
    const link = document.createElement('a');

    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
}

// 删除选中的邀请码
async function deleteSelectedCodes() {
    const selectedCodes = getSelectedCodes();

    if (selectedCodes.length === 0) {
        alert('请先选择要删除的邀请码');
        return;
    }

    if (!confirm(`确定要删除选中的 ${selectedCodes.length} 个邀请码吗？此操作不可恢复。`)) {
        return;
    }

    try {
        const response = await fetch('/api/invitation-codes/batch-delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ codes: selectedCodes })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '批量删除邀请码失败');
        }

        const result = await response.json();
        let message = `成功删除了 ${result.deletedCount}/${result.totalRequested} 个邀请码`;

        if (result.errors && result.errors.length > 0) {
            message += `\n\n错误信息:\n${result.errors.join('\n')}`;
        }

        alert(message);
        loadInvitationCodes();

    } catch (error) {
        console.error('Error batch deleting invitation codes:', error);
        alert(error.message || '批量删除邀请码失败');
    }
}

// 绑定邀请码删除按钮事件
function bindInvitationCodeDeleteEvents() {
    // 这个函数在renderInvitationCodes中调用，用于绑定动态生成的删除按钮
    // 实际的删除功能通过onclick属性直接绑定到deleteInvitationCode函数
}

// 清理过期邀请码
async function cleanupExpiredInvitationCodes() {
    if (!confirm('确定要清理所有过期的邀请码吗？')) {
        return;
    }

    try {
        const response = await fetch('/api/invitation-codes/cleanup', {
            method: 'POST',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '清理过期邀请码失败');
        }

        const result = await response.json();
        alert(`清理完成，共清理了 ${result.cleanedCount} 个过期邀请码`);

        loadInvitationCodes();

    } catch (error) {
        console.error('Error cleaning up expired codes:', error);
        alert(error.message || '清理过期邀请码失败');
    }
}

// 获取CSRF token
async function getCsrfToken() {
    try {
        const response = await fetch('/csrf-token');
        const data = await response.json();
        csrfToken = data.token;
        return csrfToken;
    } catch (error) {
        console.error('Error getting CSRF token:', error);
        return null;
    }
}

// 获取请求头
function getRequestHeaders() {
    const headers = {
        'Content-Type': 'application/json',
    };

    // 优先使用全局的getRequestHeaders函数
    if (window.getRequestHeaders && typeof window.getRequestHeaders === 'function') {
        try {
            return window.getRequestHeaders();
        } catch (e) {
            console.warn('Failed to get headers from global function:', e);
        }
    }

    // 降级方案：使用本地CSRF token
    if (csrfToken) {
        headers['x-csrf-token'] = csrfToken;
    }

    return headers;
}

// 工具函数
function showLoadingState(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = `
            <div class="loadingState">
                <div class="loadingSpinner"></div>
                <p>加载中...</p>
            </div>
        `;
    }
}

function showErrorState(containerId, message) {
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = `
            <div class="emptyState">
                <i class="fa-solid fa-exclamation-triangle"></i>
                <h4>加载失败</h4>
                <p>${escapeHtml(message)}</p>
            </div>
        `;
    }
}

function createEmptyState(iconClass, title, description) {
    return `
        <div class="emptyState">
            <i class="fa-solid ${iconClass}"></i>
            <h4>${escapeHtml(title)}</h4>
            <p>${escapeHtml(description)}</p>
        </div>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert('邀请码已复制到剪贴板');
    }).catch(() => {
        // 降级处理
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert('邀请码已复制到剪贴板');
    });
}

// 页面卸载时清理定时器
window.addEventListener('beforeunload', function() {
    stopSystemLoadAutoRefresh();
});

// 公告管理相关功能
let currentAnnouncements = [];
let currentLoginAnnouncements = [];

function bindAnnouncementEvents() {
    // 公告类型切换按钮
    const typeTabButtons = document.querySelectorAll('.announcement-type-tab');
    typeTabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const type = this.dataset.type;
            switchAnnouncementType(type);
        });
    });

    // 刷新公告按钮
    const refreshButton = document.getElementById('refreshAnnouncements');
    if (refreshButton) {
        refreshButton.addEventListener('click', function() {
            loadAnnouncements();
        });
    }

    // 刷新登录页面公告按钮
    const refreshLoginButton = document.getElementById('refreshLoginAnnouncements');
    if (refreshLoginButton) {
        refreshLoginButton.addEventListener('click', function() {
            loadLoginAnnouncements();
        });
    }

    // 创建公告表单
    const createAnnouncementForm = document.querySelector('.createAnnouncementForm');
    if (createAnnouncementForm) {
        // 克隆并替换表单以避免重复事件监听器
        const newForm = createAnnouncementForm.cloneNode(true);
        createAnnouncementForm.parentNode.replaceChild(newForm, createAnnouncementForm);

        newForm.addEventListener('submit', function(e) {
            e.preventDefault();
            createAnnouncement();
        });
    }

    // 创建登录页面公告表单
    const createLoginAnnouncementForm = document.querySelector('.createLoginAnnouncementForm');
    if (createLoginAnnouncementForm) {
        // 克隆并替换表单以避免重复事件监听器
        const newLoginForm = createLoginAnnouncementForm.cloneNode(true);
        createLoginAnnouncementForm.parentNode.replaceChild(newLoginForm, createLoginAnnouncementForm);

        newLoginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            createLoginAnnouncement(e.target);
        });
    }
}

// 切换公告类型
function switchAnnouncementType(type) {
    // 更新按钮状态
    const typeTabButtons = document.querySelectorAll('.announcement-type-tab');
    typeTabButtons.forEach(button => {
        if (button.dataset.type === type) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });

    // 切换显示的内容
    const mainSection = document.getElementById('mainAnnouncementSection');
    const loginSection = document.getElementById('loginAnnouncementSection');

    if (type === 'main') {
        mainSection.style.display = 'block';
        loginSection.style.display = 'none';
        loadAnnouncements();
    } else if (type === 'login') {
        mainSection.style.display = 'none';
        loginSection.style.display = 'block';
        loadLoginAnnouncements();
    }
}

// 加载公告列表
async function loadAnnouncements() {
    try {
        showLoadingState('announcementsContainer');

        const response = await fetch('/api/announcements', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to load announcements');
        }

        currentAnnouncements = await response.json();
        renderAnnouncements();

    } catch (error) {
        console.error('Error loading announcements:', error);
        showErrorState('announcementsContainer', '加载公告失败');
    }
}

// 渲染公告列表
function renderAnnouncements() {
    const container = document.getElementById('announcementsContainer');
    if (!container) return;

    if (currentAnnouncements.length === 0) {
        container.innerHTML = createEmptyState('fa-bullhorn', '暂无公告', '还没有创建任何公告');
        return;
    }

    const announcementsHtml = currentAnnouncements.map(announcement => createAnnouncementItem(announcement)).join('');
    container.innerHTML = announcementsHtml;
}

// 创建公告项目
function createAnnouncementItem(announcement) {
    const createdAt = new Date(announcement.createdAt).toLocaleString('zh-CN');
    const updatedAt = announcement.updatedAt ? new Date(announcement.updatedAt).toLocaleString('zh-CN') : createdAt;

    let timeInfo = `创建时间: ${createdAt}`;
    if (announcement.updatedAt && announcement.updatedAt !== announcement.createdAt) {
        timeInfo += ` | 更新时间: ${updatedAt}`;
    }

    // 移除时间有效性信息
    let validityInfo = '';

    return `
        <div class="announcementItem" data-id="${announcement.id}">
            <div class="announcementHeader">
                <div class="announcementTitle">${escapeHtml(announcement.title)}</div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="announcementStatus ${announcement.enabled ? 'enabled' : 'disabled'}">
                        ${announcement.enabled ? '已启用' : '已禁用'}
                    </span>
                </div>
            </div>
            <div class="announcementContent">${escapeHtml(announcement.content)}</div>
            <div class="announcementMeta">
                <span>${timeInfo}${validityInfo}</span>
                <span>创建者: ${escapeHtml(announcement.createdBy)}</span>
            </div>
            <div class="announcementActions">
                <button type="button" class="menu_button menu_button_icon warning" onclick="toggleAnnouncement('${announcement.id}')">
                    <i class="fa-fw fa-solid fa-${announcement.enabled ? 'pause' : 'play'}"></i>
                    <span>${announcement.enabled ? '禁用' : '启用'}</span>
                </button>
                <button type="button" class="menu_button menu_button_icon danger" onclick="deleteAnnouncement('${announcement.id}')">
                    <i class="fa-fw fa-solid fa-trash"></i>
                    <span>删除</span>
                </button>
            </div>
        </div>
    `;
}


// 创建新公告
async function createAnnouncement() {
    const form = document.querySelector('.createAnnouncementForm');
    if (!form) {
        console.error('Form not found');
        alert('表单未找到，请刷新页面重试');
        return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    if (!submitButton) {
        console.error('Submit button not found');
        alert('提交按钮未找到，请刷新页面重试');
        return;
    }

    // 防止重复提交
    if (submitButton.disabled) {
        return;
    }

    // 等待DOM更新后再查询元素
    await new Promise(resolve => setTimeout(resolve, 100));

    // 使用多种方式查询元素
    let titleInput = form.querySelector('input[name="title"]');
    let contentInput = form.querySelector('textarea[name="content"]');
    let enabledInput = form.querySelector('input[name="enabled"]');

    // 如果表单内查询失败，尝试全局查询
    if (!titleInput) {
        titleInput = document.querySelector('.announcementsBlock input[name="title"]');
    }
    if (!contentInput) {
        contentInput = document.querySelector('.announcementsBlock textarea[name="content"]');
    }
    if (!enabledInput) {
        enabledInput = document.querySelector('.announcementsBlock input[name="enabled"]');
    }


    // 如果通过name查询失败，使用索引方式获取
    let title = '';
    let content = '';
    let enabled = false;

    if (titleInput) {
        title = titleInput.value.trim();
    } else {
        // 通过索引获取第一个text类型的input
        const textInputs = form.querySelectorAll('input[type="text"]');
        if (textInputs.length > 0) {
            title = textInputs[0].value.trim();
        }
    }

    if (contentInput) {
        content = contentInput.value.trim();
    } else {
        // 通过索引获取第一个textarea
        const textareas = form.querySelectorAll('textarea');
        if (textareas.length > 0) {
            content = textareas[0].value.trim();
        }
    }

    if (enabledInput) {
        enabled = enabledInput.checked;
    } else {
        // 通过索引获取checkbox
        const checkboxes = form.querySelectorAll('input[type="checkbox"]');
        if (checkboxes.length > 0) {
            enabled = checkboxes[0].checked;
        }
    }


    const data = {
        title: title,
        content: content,
        type: 'info', // 默认类型为信息
        enabled: enabled
    };

    // 验证必填字段
    if (!data.title || !data.content) {
        alert('请填写标题和内容');
        return;
    }

    submitButton.disabled = true;
    const originalText = submitButton.innerHTML;
    submitButton.innerHTML = '<i class="fa-fw fa-solid fa-spinner fa-spin"></i><span>创建中...</span>';

    try {
        // 确保有CSRF token
        if (!csrfToken) {
            await getCsrfToken();
        }

        const response = await fetch('/api/announcements', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create announcement');
        }

        const newAnnouncement = await response.json();
        console.log('Announcement created:', newAnnouncement);

        // 重置表单
        form.reset();

        // 重新加载公告列表
        await loadAnnouncements();

        alert('公告创建成功！');

    } catch (error) {
        console.error('Error creating announcement:', error);
        alert('创建公告失败: ' + error.message);
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = originalText;
    }
}

// 切换公告启用状态
async function toggleAnnouncement(announcementId) {
    try {
        const response = await fetch(`/api/announcements/${announcementId}/toggle`, {
            method: 'POST',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to toggle announcement');
        }

        const updatedAnnouncement = await response.json();
        console.log('Announcement toggled:', updatedAnnouncement);

        // 重新加载公告列表
        await loadAnnouncements();

    } catch (error) {
        console.error('Error toggling announcement:', error);
        alert('切换公告状态失败: ' + error.message);
    }
}

// 删除公告
async function deleteAnnouncement(announcementId) {
    const announcement = currentAnnouncements.find(a => a.id === announcementId);
    if (!announcement) return;

    if (!confirm(`确定要删除公告"${announcement.title}"吗？此操作不可恢复。`)) {
        return;
    }

    try {
        const response = await fetch(`/api/announcements/${announcementId}`, {
            method: 'DELETE',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete announcement');
        }

        console.log('Announcement deleted:', announcementId);

        // 重新加载公告列表
        await loadAnnouncements();

        alert('公告删除成功！');

    } catch (error) {
        console.error('Error deleting announcement:', error);
        alert('删除公告失败: ' + error.message);
    }
}

// ========== 登录页面公告管理功能 ==========

// 加载登录页面公告列表
async function loadLoginAnnouncements() {
    try {
        showLoadingState('loginAnnouncementsContainer');

        const response = await fetch('/api/announcements/login', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to load login announcements');
        }

        currentLoginAnnouncements = await response.json();
        renderLoginAnnouncements();

    } catch (error) {
        console.error('Error loading login announcements:', error);
        showErrorState('loginAnnouncementsContainer', '加载登录页面公告失败');
    }
}

// 渲染登录页面公告列表
function renderLoginAnnouncements() {
    const container = document.getElementById('loginAnnouncementsContainer');
    if (!container) return;

    if (currentLoginAnnouncements.length === 0) {
        container.innerHTML = createEmptyState('fa-bullhorn', '暂无登录页面公告', '还没有创建任何登录页面公告');
        return;
    }

    const announcementsHtml = currentLoginAnnouncements.map(announcement => createLoginAnnouncementItem(announcement)).join('');
    container.innerHTML = announcementsHtml;
}

// 创建登录页面公告项目
function createLoginAnnouncementItem(announcement) {
    const createdAt = new Date(announcement.createdAt).toLocaleString('zh-CN');
    const updatedAt = announcement.updatedAt ? new Date(announcement.updatedAt).toLocaleString('zh-CN') : createdAt;

    let timeInfo = `创建时间: ${createdAt}`;
    if (announcement.updatedAt && announcement.updatedAt !== announcement.createdAt) {
        timeInfo += ` | 更新时间: ${updatedAt}`;
    }

    const typeMap = {
        'info': '信息',
        'warning': '警告',
        'success': '成功',
        'error': '错误'
    };
    const typeName = typeMap[announcement.type] || '信息';

    return `
        <div class="announcementItem" data-id="${announcement.id}">
            <div class="announcementHeader">
                <div class="announcementTitle">${escapeHtml(announcement.title)}</div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="announcementType ${announcement.type || 'info'}">${typeName}</span>
                    <span class="announcementStatus ${announcement.enabled ? 'enabled' : 'disabled'}">
                        ${announcement.enabled ? '已启用' : '已禁用'}
                    </span>
                </div>
            </div>
            <div class="announcementContent">${escapeHtml(announcement.content)}</div>
            <div class="announcementMeta">
                <span>${timeInfo}</span>
                <span>创建者: ${escapeHtml(announcement.createdBy)}</span>
            </div>
            <div class="announcementActions">
                <button type="button" class="menu_button menu_button_icon warning" onclick="toggleLoginAnnouncement('${announcement.id}')">
                    <i class="fa-fw fa-solid fa-${announcement.enabled ? 'pause' : 'play'}"></i>
                    <span>${announcement.enabled ? '禁用' : '启用'}</span>
                </button>
                <button type="button" class="menu_button menu_button_icon danger" onclick="deleteLoginAnnouncement('${announcement.id}')">
                    <i class="fa-fw fa-solid fa-trash"></i>
                    <span>删除</span>
                </button>
            </div>
        </div>
    `;
}

// 创建新的登录页面公告
async function createLoginAnnouncement(formElement) {
    const form = formElement || document.querySelector('.createLoginAnnouncementForm');
    if (!form) {
        console.error('Login announcement form not found');
        alert('表单未找到，请刷新页面重试');
        return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    if (!submitButton) {
        console.error('Submit button not found');
        alert('提交按钮未找到，请刷新页面重试');
        return;
    }

    // 防止重复提交
    if (submitButton.disabled) {
        return;
    }

    // 等待DOM更新后再查询元素
    await new Promise(resolve => setTimeout(resolve, 100));

    // 使用多种方式查询元素
    let titleInput = form.querySelector('input[name="title"]');
    let contentInput = form.querySelector('textarea[name="content"]');
    let typeInput = form.querySelector('select[name="type"]');
    let enabledInput = form.querySelector('input[name="enabled"]');

    // 如果表单内查询失败，尝试在登录公告区域全局查询
    if (!titleInput) {
        titleInput = document.querySelector('#loginAnnouncementSection input[name="title"]');
    }
    if (!contentInput) {
        contentInput = document.querySelector('#loginAnnouncementSection textarea[name="content"]');
    }
    if (!typeInput) {
        typeInput = document.querySelector('#loginAnnouncementSection select[name="type"]');
    }
    if (!enabledInput) {
        enabledInput = document.querySelector('#loginAnnouncementSection input[name="enabled"]');
    }

    // 如果通过name查询失败，使用索引方式获取
    let title = '';
    let content = '';
    let type = 'info';
    let enabled = true;

    if (titleInput) {
        title = titleInput.value.trim();
    } else {
        // 通过索引获取第一个text类型的input
        const textInputs = form.querySelectorAll('input[type="text"]');
        if (textInputs.length > 0) {
            title = textInputs[0].value.trim();
        }
    }

    if (contentInput) {
        content = contentInput.value.trim();
    } else {
        // 通过索引获取第一个textarea
        const textareas = form.querySelectorAll('textarea');
        if (textareas.length > 0) {
            content = textareas[0].value.trim();
        }
    }

    if (typeInput) {
        type = typeInput.value;
    } else {
        // 通过索引获取第一个select
        const selects = form.querySelectorAll('select');
        if (selects.length > 0) {
            type = selects[0].value;
        }
    }

    if (enabledInput) {
        enabled = enabledInput.checked;
    } else {
        // 通过索引获取checkbox
        const checkboxes = form.querySelectorAll('input[type="checkbox"]');
        if (checkboxes.length > 0) {
            enabled = checkboxes[0].checked;
        }
    }

    const data = {
        title: title,
        content: content,
        type: type,
        enabled: enabled
    };

    console.log('Login announcement form data:', data);

    // 验证必填字段
    if (!data.title || !data.content) {
        alert('请填写标题和内容');
        return;
    }

    submitButton.disabled = true;
    const originalText = submitButton.innerHTML;
    submitButton.innerHTML = '<i class="fa-fw fa-solid fa-spinner fa-spin"></i><span>创建中...</span>';

    try {
        // 确保有CSRF token
        if (!csrfToken) {
            await getCsrfToken();
        }

        const response = await fetch('/api/announcements/login', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create login announcement');
        }

        const newAnnouncement = await response.json();
        console.log('Login announcement created:', newAnnouncement);

        // 重置表单
        form.reset();

        // 重新加载公告列表
        await loadLoginAnnouncements();

        alert('登录页面公告创建成功！');

    } catch (error) {
        console.error('Error creating login announcement:', error);
        alert('创建登录页面公告失败: ' + error.message);
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = originalText;
    }
}

// 切换登录页面公告启用状态
async function toggleLoginAnnouncement(announcementId) {
    try {
        const response = await fetch(`/api/announcements/login/${announcementId}/toggle`, {
            method: 'POST',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to toggle login announcement');
        }

        const updatedAnnouncement = await response.json();
        console.log('Login announcement toggled:', updatedAnnouncement);

        // 重新加载公告列表
        await loadLoginAnnouncements();

    } catch (error) {
        console.error('Error toggling login announcement:', error);
        alert('切换登录页面公告状态失败: ' + error.message);
    }
}

// 删除登录页面公告
async function deleteLoginAnnouncement(announcementId) {
    const announcement = currentLoginAnnouncements.find(a => a.id === announcementId);
    if (!announcement) return;

    if (!confirm(`确定要删除登录页面公告"${announcement.title}"吗？此操作不可恢复。`)) {
        return;
    }

    try {
        const response = await fetch(`/api/announcements/login/${announcementId}`, {
            method: 'DELETE',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete login announcement');
        }

        console.log('Login announcement deleted:', announcementId);

        // 重新加载公告列表
        await loadLoginAnnouncements();

        alert('登录页面公告删除成功！');

    } catch (error) {
        console.error('Error deleting login announcement:', error);
        alert('删除登录页面公告失败: ' + error.message);
    }
}

// 将函数添加到全局作用域，以便HTML的onclick可以调用
window.toggleLoginAnnouncement = toggleLoginAnnouncement;
window.deleteLoginAnnouncement = deleteLoginAnnouncement;

// ============================================================
// 邮件配置管理
// ============================================================

// 加载邮件配置
async function loadEmailConfig() {
    try {
        const response = await fetch('/api/email-config/get', {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to load email config');
        }

        const config = await response.json();

        // 填充表单
        $('#emailEnabled').prop('checked', config.enabled || false);
        $('#emailSmtpHost').val(config.host || '');
        $('#emailSmtpPort').val(config.port || 587);
        $('#emailSmtpSecure').prop('checked', config.secure || false);
        $('#emailSmtpUser').val(config.user || '');
        $('#emailSmtpPassword').val(config.password || '');
        $('#emailFrom').val(config.from || '');
        $('#emailFromName').val(config.fromName || 'SillyTavern');

    } catch (error) {
        console.error('Error loading email config:', error);
        alert('加载邮件配置失败: ' + error.message);
    }
}

// 保存邮件配置
async function saveEmailConfig() {
    const saveButton = $('#saveEmailConfig');
    const originalText = saveButton.html();

    try {
        saveButton.prop('disabled', true);
        saveButton.html('<i class="fa-fw fa-solid fa-spinner fa-spin"></i> 保存中...');

        const config = {
            enabled: $('#emailEnabled').prop('checked'),
            host: $('#emailSmtpHost').val().trim(),
            port: parseInt($('#emailSmtpPort').val()) || 587,
            secure: $('#emailSmtpSecure').prop('checked'),
            user: $('#emailSmtpUser').val().trim(),
            password: $('#emailSmtpPassword').val() || '',  // 确保密码字段不为 undefined
            from: $('#emailFrom').val().trim(),
            fromName: $('#emailFromName').val().trim() || 'SillyTavern'
        };

        // 验证必填字段
        if (config.enabled) {
            if (!config.host || !config.user || !config.password || !config.from) {
                alert('请填写所有必填字段（SMTP服务器、用户名、密码、发件人邮箱）');
                return;
            }

            // 验证邮箱格式
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(config.from)) {
                alert('发件人邮箱格式不正确');
                return;
            }
        }

        const response = await fetch('/api/email-config/save', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(config)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save email config');
        }

        const result = await response.json();
        console.log('Email config saved:', result);

        alert('邮件配置保存成功！部分更改可能需要重启服务器才能生效。');

    } catch (error) {
        console.error('Error saving email config:', error);
        alert('保存邮件配置失败: ' + error.message);
    } finally {
        saveButton.prop('disabled', false);
        saveButton.html(originalText);
    }
}

// 测试邮件配置
async function testEmailConfig() {
    const testButton = $('#testEmailConfig');
    const originalText = testButton.html();

    try {
        // 先保存当前配置
        await saveEmailConfig();

        const testEmail = prompt('请输入测试邮箱地址：', '');

        if (!testEmail) {
            return;
        }

        // 验证邮箱格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(testEmail)) {
            alert('邮箱格式不正确');
            return;
        }

        testButton.prop('disabled', true);
        testButton.html('<i class="fa-fw fa-solid fa-spinner fa-spin"></i> 发送中...');

        const response = await fetch('/api/email-config/test', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ testEmail })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to test email config');
        }

        const result = await response.json();
        console.log('Email test result:', result);

        alert('测试邮件已发送，请检查您的邮箱！');

    } catch (error) {
        console.error('Error testing email config:', error);
        alert('测试邮件发送失败: ' + error.message);
    } finally {
        testButton.prop('disabled', false);
        testButton.html(originalText);
    }
}

// 初始化邮件配置事件
function initializeEmailConfig() {
    // 绑定保存按钮
    $('#saveEmailConfig').off('click').on('click', saveEmailConfig);

    // 绑定测试按钮
    $('#testEmailConfig').off('click').on('click', testEmailConfig);
}

// 将邮件配置初始化添加到主初始化函数中
const originalInitialize = window.initializeAdminExtensions;
window.initializeAdminExtensions = function() {
    if (typeof originalInitialize === 'function') {
        originalInitialize();
    }
    initializeEmailConfig();
};

// 导出函数供外部调用
if (typeof window !== 'undefined') {
    window.initializeAdminExtensions = initializeAdminExtensions;
    window.toggleAnnouncement = toggleAnnouncement;
    window.deleteAnnouncement = deleteAnnouncement;
}
