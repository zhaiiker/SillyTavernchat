import { initAccessibility } from './a11y.js';

/**
 * CRSF token for requests.
 */
let csrfToken = '';
let discreetLogin = false;

/**
 * Gets a CSRF token from the server.
 * @returns {Promise<string>} CSRF token
 */
async function getCsrfToken() {
    const response = await fetch('/csrf-token');
    const data = await response.json();
    return data.token;
}

/**
 * Gets a list of users from the server.
 * @returns {Promise<object>} List of users
 */
async function getUserList() {
    const response = await fetch('/api/users/list', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
    });

    if (!response.ok) {
        const errorData = await response.json();
        return displayError(errorData.error || 'An error occurred');
    }

    if (response.status === 204) {
        discreetLogin = true;
        return [];
    }

    const userListObj = await response.json();
    console.log(userListObj);
    return userListObj;
}

/**
 * Requests a recovery code for the user.
 * @param {string} handle User handle
 * @returns {Promise<void>}
 */
async function sendRecoveryPart1(handle) {
    const response = await fetch('/api/users/recover-step1', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ handle }),
    });

    if (!response.ok) {
        const errorData = await response.json();
        return displayError(errorData.error || 'An error occurred');
    }

    const data = await response.json();
    showRecoveryBlock();

    // 显示恢复码发送方式的提示信息
    if (data.method === 'email') {
        displayError(data.message || '密码恢复码已发送至您的邮箱，请查收', true);
    } else {
        displayError(data.message || '密码恢复码已显示在服务器控制台，请联系管理员获取', true);
    }
}

/**
 * Sets a new password for the user using the recovery code.
 * @param {string} handle User handle
 * @param {string} code Recovery code
 * @param {string} newPassword New password
 * @returns {Promise<void>}
 */
async function sendRecoveryPart2(handle, code, newPassword) {
    const recoveryData = {
        handle,
        code,
        newPassword,
    };

    const response = await fetch('/api/users/recover-step2', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(recoveryData),
    });

    if (!response.ok) {
        const errorData = await response.json();
        return displayError(errorData.error || 'An error occurred');
    }

    console.log(`Successfully recovered password for ${handle}!`);
    await performLogin(handle, newPassword);
}

// 存储当前登录尝试的用户信息（用于续费）
let currentLoginAttempt = {
    handle: '',
    password: ''
};

// 登录中状态标志，防止重复登录
let isLoggingIn = false;

/**
 * Attempts to log in the user.
 * @param {string} handle User's handle
 * @param {string} password User's password
 * @returns {Promise<void>}
 */
async function performLogin(handle, password) {
    // 验证输入
    if (!handle || typeof handle !== 'string' || handle.trim() === '') {
        return displayError('请输入用户名');
    }

    // 防止重复登录
    if (isLoggingIn) {
        return;
    }

    isLoggingIn = true;

    const userInfo = {
        handle: handle,
        password: password || '',
    };

    // 保存登录信息（用于续费）
    currentLoginAttempt.handle = handle;
    currentLoginAttempt.password = password || '';

    try {
        const response = await fetch('/api/users/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify(userInfo),
        });

        if (!response.ok) {
            const errorData = await response.json();

            // 如果账户过期，显示续费窗口
            if (errorData.expired) {
                showRenewalBlock(errorData.purchaseLink);
                isLoggingIn = false;
                return;
            }

            let errorMessage = errorData.error || 'An error occurred';
            isLoggingIn = false;
            return displayError(errorMessage);
        }

        const data = await response.json();

        if (data.handle) {
            console.log(`Successfully logged in as ${handle}!`);
            // 登录成功，不重置标志，因为即将跳转
            redirectToHome();
        } else {
            isLoggingIn = false;
        }
    } catch (error) {
        console.error('Error logging in:', error);
        isLoggingIn = false;
        displayError(String(error));
    }
}

/**
 * Handles the user selection event.
 * @param {object} user User object
 * @returns {Promise<void>}
 */
async function onUserSelected(user) {
    // No password, just log in
    if (!user.password) {
        return await performLogin(user.handle, '');
    }

    $('#passwordRecoveryBlock').hide();
    $('#passwordEntryBlock').show();
    $('#loginButton').off('click').on('click', async () => {
        const password = String($('#userPassword').val());
        await performLogin(user.handle, password);
    });

    $('#recoverPassword').off('click').on('click', async () => {
        await sendRecoveryPart1(user.handle);
    });

    $('#sendRecovery').off('click').on('click', async () => {
        const code = String($('#recoveryCode').val());
        const newPassword = String($('#newPassword').val());
        await sendRecoveryPart2(user.handle, code, newPassword);
    });

    displayError('');
}


/**
 * Redirects the user to the home page.
 * Preserves the query string.
 */
function redirectToHome() {
    // Create a URL object based on the current location
    const currentUrl = new URL(window.location.href);

    // After a login there's no need to preserve the
    // noauto parameter (if present)
    currentUrl.searchParams.delete('noauto');

    // Set the pathname to root and keep the updated query string
    currentUrl.pathname = '/';

    // Redirect to the new URL
    window.location.href = currentUrl.toString();
}

/**
 * Hides the password entry block and shows the password recovery block.
 */
function showRecoveryBlock() {
    $('#passwordEntryBlock').hide();
    $('#passwordRecoveryBlock').show();
    displayError('');
}

/**
 * Hides the password recovery block and shows the password entry block.
 */
function onCancelRecoveryClick() {
    $('#passwordRecoveryBlock').hide();
    $('#passwordEntryBlock').show();
    displayError('');
}


function onRegisterClick() {
    // 跳转到注册页面
    window.location.href = '/register';
}
/**
 * Configures the login page for normal login.
 * @param {import('../../src/users').UserViewModel[]} userList List of users
 */
function configureNormalLogin(userList) {
    console.log('Discreet login is disabled');
    $('#handleEntryBlock').hide();
    $('#normalLoginPrompt').show();
    $('#discreetLoginPrompt').hide();
    console.log(userList);
    for (const user of userList) {
        const userBlock = $('<div></div>').addClass('userSelect');
        const avatarBlock = $('<div></div>').addClass('avatar');
        avatarBlock.append($('<img>').attr('src', user.avatar));
        userBlock.append(avatarBlock);
        userBlock.append($('<span></span>').addClass('userName').text(user.name));
        userBlock.append($('<small></small>').addClass('userHandle').text(user.handle));
        userBlock.on('click', () => onUserSelected(user));
        $('#userList').append(userBlock);
    }
}

/**
 * Configures the login page for discreet login.
 */
function configureDiscreetLogin() {
    $('#handleEntryBlock').show();
    $('#normalLoginPrompt').hide();
    $('#discreetLoginPrompt').show();
    $('#userList').hide();
    $('#passwordRecoveryBlock').hide();
    $('#passwordEntryBlock').show();
    $('#loginButton').off('click').on('click', async () => {
        const rawHandle = String($('#userHandle').val() || '').trim();

        if (!rawHandle) {
            displayError('请输入用户名');
            return;
        }

        // 规范化用户名：支持英文大小写、数字和横杠
        const handle = normalizeHandleFrontend(rawHandle);

        if (!handle) {
            displayError('用户名格式无效，仅支持英文、数字和横杠');
            return;
        }

        const password = String($('#userPassword').val() || '');
        await performLogin(handle, password);
    });

    $('#recoverPassword').off('click').on('click', async () => {
        const rawHandle = String($('#userHandle').val());
        // 规范化用户名
        const handle = normalizeHandleFrontend(rawHandle);
        await sendRecoveryPart1(handle);
    });

    $('#sendRecovery').off('click').on('click', async () => {
        const rawHandle = String($('#userHandle').val());
        // 规范化用户名
        const handle = normalizeHandleFrontend(rawHandle);
        const code = String($('#recoveryCode').val());
        const newPassword = String($('#newPassword').val());
        await sendRecoveryPart2(handle, code, newPassword);
    });
}

(async function () {
    initAccessibility();

    try {
        // 先获取CSRF token
        csrfToken = await getCsrfToken();
    } catch (error) {
        console.error('获取CSRF Token失败:', error);
        displayError('初始化失败，请刷新页面重试');
        return;
    }

    const userList = await getUserList();

    if (discreetLogin) {
        configureDiscreetLogin();
    } else {
        configureNormalLogin(userList);
    }
    document.getElementById('shadow_popup').style.opacity = '';
    $('#cancelRecovery').on('click', onCancelRecoveryClick);
    $('#registerButton').on('click', onRegisterClick);
    $('#cancelRenewal').on('click', onCancelRenewalClick);
    $('#submitRenewal').on('click', onSubmitRenewalClick);

    // 检查是否有账户过期提示
    const accountExpired = sessionStorage.getItem('accountExpired');
    const expiredPurchaseLink = sessionStorage.getItem('expiredPurchaseLink');
    if (accountExpired === 'true') {
        // 清除sessionStorage
        sessionStorage.removeItem('accountExpired');
        sessionStorage.removeItem('expiredMessage');
        sessionStorage.removeItem('expiredPurchaseLink');

        // 直接显示续费窗口
        showRenewalBlock(expiredPurchaseLink);
    }

    // 加载并显示登录页面公告
    await loadLoginAnnouncements();

    $(document).on('keydown', (evt) => {
        if (evt.key === 'Enter' && document.activeElement.tagName === 'INPUT') {
            // 阻止默认行为，防止表单重复提交
            evt.preventDefault();

            if ($('#passwordRecoveryBlock').is(':visible')) {
                $('#sendRecovery').trigger('click');
            } else if ($('#renewalBlock').is(':visible')) {
                $('#submitRenewal').trigger('click');
            } else if ($('#passwordEntryBlock').is(':visible') || $('#handleEntryBlock').is(':visible')) {
                $('#loginButton').trigger('click');
            }
        }
    });
})();

/**
 * 显示续费窗口
 * @param {string} purchaseLink 购买链接
 */
function showRenewalBlock(purchaseLink) {
    // 隐藏所有其他块
    $('#userListBlock').hide();
    $('#passwordRecoveryBlock').hide();
    $('#errorMessage').hide();

    // 显示续费块
    $('#renewalBlock').show();

    // 显示购买链接（如果有）
    if (purchaseLink) {
        $('#renewalPurchaseLink').show();
        $('#renewalPurchaseLinkUrl').text(purchaseLink).attr('href', purchaseLink);
    } else {
        $('#renewalPurchaseLink').hide();
    }

    // 清空输入框
    $('#renewalCode').val('');

    // 焦点到输入框
    setTimeout(() => {
        $('#renewalCode').focus();
    }, 200);
}

/**
 * 取消续费，返回登录界面
 */
function onCancelRenewalClick() {
    $('#renewalBlock').hide();
    $('#userListBlock').show();
    $('#errorMessage').hide();
}

/**
 * 提交续费请求
 */
async function onSubmitRenewalClick() {
    const renewalCode = String($('#renewalCode').val() || '').trim();

    if (!renewalCode) {
        displayError('请输入续费码');
        return;
    }

    if (!currentLoginAttempt.handle || !currentLoginAttempt.password) {
        displayError('登录信息丢失，请重新登录');
        onCancelRenewalClick();
        return;
    }

    try {
        const response = await fetch('/api/users/renew-expired', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({
                handle: currentLoginAttempt.handle,
                password: currentLoginAttempt.password,
                invitationCode: renewalCode
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            displayError(errorData.error || '续费失败');
            return;
        }

        const data = await response.json();

        if (data.success) {
            displayError('续费成功！正在登录...', true);
            // 续费成功后自动登录
            setTimeout(async () => {
                await performLogin(currentLoginAttempt.handle, currentLoginAttempt.password);
            }, 1000);
        }
    } catch (error) {
        console.error('Error renewing account:', error);
        displayError('续费失败：' + String(error));
    }
}

/**
 * 显示错误或成功消息
 * @param {string} message 消息内容
 * @param {boolean} isSuccess 是否为成功消息
 */
function displayError(message, isSuccess = false) {
    const errorBlock = $('#errorMessage');
    errorBlock.text(message);
    errorBlock.show();

    // 如果是成功消息，改变样式
    if (isSuccess) {
        errorBlock.css({
            'background': 'rgba(40, 167, 69, 0.2)',
            'border-color': 'rgba(40, 167, 69, 0.5)',
            'color': '#a8e6a1'
        });
    } else {
        errorBlock.css({
            'background': '',
            'border-color': '',
            'color': ''
        });
    }
}

/**
 * 获取并显示登录页面公告
 */
async function loadLoginAnnouncements() {
    try {
        const response = await fetch('/api/announcements/login/current', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            console.error('Failed to load login announcements');
            return;
        }

        const announcements = await response.json();
        console.log('Login announcements loaded:', announcements);

        if (announcements && announcements.length > 0) {
            showLoginAnnouncements(announcements);
        }
    } catch (error) {
        console.error('Error loading login announcements:', error);
    }
}

/**
 * 显示登录页面公告
 * @param {Array} announcements 公告列表
 */
function showLoginAnnouncements(announcements) {
    const announcementArea = $('#loginAnnouncementArea');
    announcementArea.empty();

    if (!announcements || announcements.length === 0) {
        announcementArea.hide();
        return;
    }

    announcements.forEach(announcement => {
        const typeClass = announcement.type || 'info';
        const typeName = {
            'info': '信息',
            'warning': '警告',
            'success': '成功',
            'error': '错误'
        }[typeClass] || '信息';

        const createdDate = announcement.createdAt
            ? new Date(announcement.createdAt).toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            })
            : '';

        const announcementHtml = `
            <div class="login-announcement-item">
                <div class="login-announcement-header">
                    <i class="fa-solid fa-bullhorn login-announcement-icon"></i>
                    <div class="login-announcement-title">${escapeHtml(announcement.title)}</div>
                    <span class="login-announcement-type-badge ${typeClass}">${typeName}</span>
                </div>
                <div class="login-announcement-content">${escapeHtml(announcement.content)}</div>
                ${createdDate ? `<div class="login-announcement-time"><i class="fa-solid fa-clock"></i><span>${createdDate}</span></div>` : ''}
            </div>
        `;
        announcementArea.append(announcementHtml);
    });

    announcementArea.show();
}

/**
 * 前端用户名规范化函数（与后端保持一致）
 * @param {string} handle 原始用户名
 * @returns {string} 规范化后的用户名
 */
function normalizeHandleFrontend(handle) {
    if (!handle || typeof handle !== 'string') {
        return '';
    }

    return handle
        .toLowerCase()                    // 转换为小写
        .trim()                           // 去除首尾空格
        .replace(/[^a-z0-9-]/g, '-')      // 将非字母数字字符替换为横杠
        .replace(/-+/g, '-')              // 连续横杠合并为一个
        .replace(/^-+|-+$/g, '');         // 去除首尾横杠
}

/**
 * HTML转义，防止XSS
 * @param {string} text 要转义的文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
