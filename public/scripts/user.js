import { getRequestHeaders } from '../script.js';
import { POPUP_RESULT, POPUP_TYPE, callGenericPopup } from './popup.js';
import { renderTemplateAsync } from './templates.js';
import { ensureImageFormatSupported, getBase64Async, humanFileSize } from './utils.js';

/**
 * @type {import('../../src/users.js').UserViewModel} Logged in user
 */
export let currentUser = null;
export let accountsEnabled = false;

// Extend the session every 10 minutes
const SESSION_EXTEND_INTERVAL = 10 * 60 * 1000;
// Heartbeat every 60 seconds to detect online presence
const HEARTBEAT_INTERVAL = 60 * 1000;

// Lightweight online presence indicator
window.isUserOnline = false;
window.userHeartbeat = (function () {
    /** @type {number | null} */
    let timerId = null;
    /** @type {boolean} */
    let running = false;

    async function sendHeartbeat() {
        try {
            if (!accountsEnabled || !currentUser) return;
            const response = await fetch('/api/users/heartbeat', {
                method: 'POST',
                headers: getRequestHeaders(),
            });

            const ok = response && response.ok;
            if (ok) {
                if (!window.isUserOnline) {
                    window.isUserOnline = true;
                    window.dispatchEvent(new CustomEvent('user-online-state', { detail: { online: true } }));
                }
            } else {
                if (window.isUserOnline) {
                    window.isUserOnline = false;
                    window.dispatchEvent(new CustomEvent('user-online-state', { detail: { online: false } }));
                }
            }
        } catch {
            if (window.isUserOnline) {
                window.isUserOnline = false;
                window.dispatchEvent(new CustomEvent('user-online-state', { detail: { online: false } }));
            }
        }
    }

    function start() {
        if (running) return;
        running = true;
        // Immediate ping once started
        void sendHeartbeat();
        timerId = window.setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL);
    }

    function stop() {
        running = false;
        if (timerId !== null) {
            clearInterval(timerId);
            timerId = null;
        }
    }

    function forceStart() {
        stop();
        start();
    }

    // Auto pause/resume on tab visibility
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // keep minimal heartbeat once hidden to reduce noise
            if (timerId !== null) {
                clearInterval(timerId);
                timerId = window.setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL * 2);
            }
        } else if (running) {
            if (timerId !== null) {
                clearInterval(timerId);
            }
            // resume normal cadence and send an immediate ping
            void sendHeartbeat();
            timerId = window.setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL);
        }
    });

    return { start, stop, forceStart };
})();

/**
 * Enable or disable user account controls in the UI.
 * @param {boolean} isEnabled User account controls enabled
 * @returns {Promise<void>}
 */
export async function setUserControls(isEnabled) {
    accountsEnabled = isEnabled;

    if (!isEnabled) {
        $('#logout_button').hide();
        $('#admin_button').hide();
        return;
    }

    $('#logout_button').show();
    await getCurrentUser();
}

/**
 * Check if the current user is an admin.
 * @returns {boolean} True if the current user is an admin
 */
export function isAdmin() {
    if (!accountsEnabled) {
        return true;
    }

    if (!currentUser) {
        return false;
    }

    return Boolean(currentUser.admin);
}

/**
 * Gets the handle string of the current user.
 * @returns {string} User handle
 */
export function getCurrentUserHandle() {
    return currentUser?.handle || 'default-user';
}

/**
 * Get the current user.
 * @returns {Promise<void>}
 */
async function getCurrentUser() {
    try {
        const response = await fetch('/api/users/me', {
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            throw new Error('Failed to get current user');
        }

        currentUser = await response.json();
        $('#admin_button').toggle(accountsEnabled && isAdmin());

        // 启动用户心跳
        if (typeof window.userHeartbeat !== 'undefined' && window.userHeartbeat.forceStart) {
            setTimeout(() => {
                // 检查CSRF token是否可用
                const hasToken = window.token || window.csrfToken;
                if (hasToken) {
                    window.userHeartbeat.forceStart();
                    console.log('User heartbeat force started after getCurrentUser with token');
                } else {
                    console.warn('CSRF token not available, delaying heartbeat start');
                    // 再延迟一次
                    setTimeout(() => {
                        window.userHeartbeat.forceStart();
                        console.log('User heartbeat force started after token delay');
                    }, 2000);
                }
            }, 1000);
        }


    } catch (error) {
        console.error('Error getting current user:', error);
    }
}

/**
 * Get a list of all users.
 * @param {boolean} includeStorageSize - 是否包含存储大小信息（默认false以提高性能）
 * @returns {Promise<import('../../src/users.js').UserViewModel[]>} Users
 */
async function getUsers(includeStorageSize = false) {
    try {
        const response = await fetch('/api/users/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ includeStorageSize }),
        });

        if (!response.ok) {
            throw new Error('Failed to get users');
        }

        return response.json();
    } catch (error) {
        console.error('Error getting users:', error);
    }
}

/**
 * 批量获取用户的存储占用大小
 * @param {string[]} handles - 用户句柄数组
 * @returns {Promise<Object.<string, {storageSize?: number, error?: string}>>} 用户存储大小映射
 */
async function getUsersStorageSize(handles) {
    try {
        const response = await fetch('/api/users/storage-size', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handles }),
        });

        if (!response.ok) {
            throw new Error('Failed to get users storage size');
        }

        return response.json();
    } catch (error) {
        console.error('Error getting users storage size:', error);
        return {};
    }
}

/**
 * Enable a user account.
 * @param {string} handle User handle
 * @param {function} callback Success callback
 * @returns {Promise<void>}
 */
async function enableUser(handle, callback) {
    try {
        const response = await fetch('/api/users/enable', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to enable user');
            throw new Error('Failed to enable user');
        }

        callback();
    } catch (error) {
        console.error('Error enabling user:', error);
    }
}

async function disableUser(handle, callback) {
    try {
        const response = await fetch('/api/users/disable', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data?.error || 'Unknown error', 'Failed to disable user');
            throw new Error('Failed to disable user');
        }

        callback();
    } catch (error) {
        console.error('Error disabling user:', error);
    }
}

/**
 * Promote a user to admin.
 * @param {string} handle User handle
 * @param {function} callback Success callback
 * @returns {Promise<void>}
 */
async function promoteUser(handle, callback) {
    try {
        const response = await fetch('/api/users/promote', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to promote user');
            throw new Error('Failed to promote user');
        }

        callback();
    } catch (error) {
        console.error('Error promoting user:', error);
    }
}

/**
 * Demote a user from admin.
 * @param {string} handle User handle
 * @param {function} callback Success callback
 */
async function demoteUser(handle, callback) {
    try {
        const response = await fetch('/api/users/demote', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to demote user');
            throw new Error('Failed to demote user');
        }

        callback();
    } catch (error) {
        console.error('Error demoting user:', error);
    }
}

/**
 * Create a new user.
 * @param {HTMLFormElement} form Form element
 */
async function createUser(form, callback) {
    const errors = [];
    const formData = new FormData(form);

    if (!formData.get('handle')) {
        errors.push('Handle is required');
    }

    if (formData.get('password') !== formData.get('confirm')) {
        errors.push('Passwords do not match');
    }

    if (errors.length) {
        toastr.error(errors.join(', '), 'Failed to create user');
        return;
    }

    const body = {};
    formData.forEach(function (value, key) {
        if (key === 'confirm') {
            return;
        }
        if (key.startsWith('_')) {
            key = key.substring(1);
        }
        body[key] = value;
    });

    try {
        const response = await fetch('/api/users/create', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to create user');
            throw new Error('Failed to create user');
        }

        form.reset();
        callback();
    } catch (error) {
        console.error('Error creating user:', error);
    }
}

/**
 * Backup a user's data.
 * @param {string} handle Handle of the user to backup
 * @param {function} callback Success callback
 * @returns {Promise<void>}
 */
async function backupUserData(handle, callback) {
    try {
        toastr.info('Please wait for the download to start.', 'Backup Requested');
        const response = await fetch('/api/users/backup', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to backup user data');
            throw new Error('Failed to backup user data');
        }

        const blob = await response.blob();
        const header = response.headers.get('Content-Disposition');
        const parts = header.split(';');
        const filename = parts[1].split('=')[1].replaceAll('"', '');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        callback();
    } catch (error) {
        console.error('Error backing up user data:', error);
    }
}

/**
 * Shows a popup to change a user's password.
 * @param {string} handle User handle
 * @param {function} callback Success callback
 */
async function changePassword(handle, callback) {
    try {
        const template = $(await renderTemplateAsync('changePassword'));
        template.find('.currentPasswordBlock').toggle(!isAdmin());
        let newPassword = '';
        let confirmPassword = '';
        let oldPassword = '';
        template.find('input[name="current"]').on('input', function () {
            oldPassword = String($(this).val());
        });
        template.find('input[name="password"]').on('input', function () {
            newPassword = String($(this).val());
        });
        template.find('input[name="confirm"]').on('input', function () {
            confirmPassword = String($(this).val());
        });
        const result = await callGenericPopup(template, POPUP_TYPE.CONFIRM, '', { okButton: 'Change', cancelButton: 'Cancel', wide: false, large: false });
        if (result === POPUP_RESULT.CANCELLED || result === POPUP_RESULT.NEGATIVE) {
            throw new Error('Change password cancelled');
        }

        if (newPassword !== confirmPassword) {
            toastr.error('Passwords do not match', 'Failed to change password');
            throw new Error('Passwords do not match');
        }

        const response = await fetch('/api/users/change-password', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle, newPassword, oldPassword }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to change password');
            throw new Error('Failed to change password');
        }

        toastr.success('Password changed successfully', 'Password Changed');
        callback();
    }
    catch (error) {
        console.error('Error changing password:', error);
    }
}

/**
 * Clear backups for a user.
 * @param {string} handle User handle
 * @param {function} callback Success callback
 */
async function clearUserBackups(handle, callback) {
    try {
        const template = $(await renderTemplateAsync('clearUserBackups'));
        template.find('#clearUserName').text(handle);

        const result = await callGenericPopup(template, POPUP_TYPE.CONFIRM, '', { okButton: '清理', cancelButton: '取消', wide: false, large: false });

        if (result !== POPUP_RESULT.AFFIRMATIVE) {
            throw new Error('Clear backups cancelled');
        }

        toastr.info('正在清理备份文件，请稍候...', '清理中');

        const response = await fetch('/api/users/clear-backups', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', '清理失败');
            throw new Error('Failed to clear backups');
        }

        const data = await response.json();
        toastr.success(data.message, '清理成功');
        callback();
    } catch (error) {
        console.error('Error clearing backups:', error);
    }
}

/**
 * Clear backups for all users.
 * @param {function} callback Success callback
 */
async function clearAllBackups(callback) {
    try {
        const confirm = await callGenericPopup(
            '确定要清理所有用户的备份文件吗？此操作不可恢复！',
            POPUP_TYPE.CONFIRM,
            '',
            { okButton: '确认清理', cancelButton: '取消', wide: false, large: false },
        );

        if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
            throw new Error('Clear all backups cancelled');
        }

        toastr.info('正在清理所有用户的备份文件，请稍候...', '清理中');

        const response = await fetch('/api/users/clear-all-backups', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', '清理失败');
            throw new Error('Failed to clear all backups');
        }

        const data = await response.json();
        toastr.success(data.message, '清理成功');
        callback();
    } catch (error) {
        console.error('Error clearing all backups:', error);
    }
}

/**
 * Delete inactive users who haven't logged in for 60 days (2 months).
 * @param {function} callback Success callback
 */
async function deleteInactiveUsers(callback) {
    try {
        // 第一步：预览将要删除的用户
        toastr.info('正在扫描不活跃用户，请稍候...', '扫描中');

        const previewResponse = await fetch('/api/users/delete-inactive-users', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ dryRun: true }),
        });

        if (!previewResponse.ok) {
            const data = await previewResponse.json();
            toastr.error(data.error || 'Unknown error', '扫描失败');
            throw new Error('Failed to preview inactive users');
        }

        const previewData = await previewResponse.json();

        if (previewData.totalUsers === 0) {
            toastr.info('没有发现超过2个月未登录的用户', '无需清理');
            return;
        }

        // 构建用户列表HTML
        let userListHtml = '<div class="flex-container flexFlowColumn flexGap5" style="max-height: 800px; overflow-y: auto;">';
        userListHtml += '<p style="margin: 10px 0;">以下用户将被删除（包括所有数据）：</p>';
        userListHtml += '<ul style="text-align: left; margin: 10px 0;">';

        for (const user of previewData.inactiveUsers) {
            const sizeMB = (user.storageSize / 1024 / 1024).toFixed(2);
            userListHtml += `<li style="margin: 5px 0; padding: 5px; background: rgba(255,0,0,0.1); border-radius: 3px;">`;
            userListHtml += `<strong>${user.name}</strong> (${user.handle})<br>`;
            userListHtml += `<small>最后登录: ${user.lastActivityFormatted} (${user.daysSinceLastActivity}天前)</small><br>`;
            userListHtml += `<small>存储占用: ${sizeMB} MB</small>`;
            userListHtml += `</li>`;
        }

        userListHtml += '</ul>';
        userListHtml += `<p style="margin: 10px 0; font-weight: bold; color: red;">`;
        userListHtml += `共 ${previewData.totalUsers} 个用户，总计 ${(previewData.totalSize / 1024 / 1024).toFixed(2)} MB`;
        userListHtml += `</p>`;
        userListHtml += '<p style="margin: 10px 0; color: orange;"><strong>⚠️ 警告：此操作不可恢复！</strong></p>';
        userListHtml += '</div>';

        const confirmTemplate = $(userListHtml);

        const confirm = await callGenericPopup(
            confirmTemplate,
            POPUP_TYPE.CONFIRM,
            '确认删除2个月未登录用户',
            { okButton: '确认删除', cancelButton: '取消', wide: true, large: false, allowVerticalScrolling: true },
        );

        if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
            throw new Error('Delete inactive users cancelled');
        }

        // 第二步：确认后执行删除
        toastr.info('正在删除不活跃用户，请稍候...', '删除中');

        const deleteResponse = await fetch('/api/users/delete-inactive-users', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ dryRun: false }),
        });

        if (!deleteResponse.ok) {
            const data = await deleteResponse.json();
            toastr.error(data.error || 'Unknown error', '删除失败');
            throw new Error('Failed to delete inactive users');
        }

        const deleteData = await deleteResponse.json();

        // 显示详细结果
        let resultMessage = deleteData.message;
        if (deleteData.failedUsers && deleteData.failedUsers.length > 0) {
            resultMessage += `\n失败 ${deleteData.failedUsers.length} 个用户`;
        }

        toastr.success(resultMessage, '删除完成');
        callback();
    } catch (error) {
        if (error.message !== 'Delete inactive users cancelled') {
            console.error('Error deleting inactive users:', error);
        }
    }
}

/**
 * Delete a user.
 * @param {string} handle User handle
 * @param {function} callback Success callback
 */
async function deleteUser(handle, callback) {
    try {
        if (handle === currentUser.handle) {
            toastr.error('Cannot delete yourself', 'Failed to delete user');
            throw new Error('Cannot delete yourself');
        }

        let purge = false;
        let confirmHandle = '';

        const template = $(await renderTemplateAsync('deleteUser'));
        template.find('#deleteUserName').text(handle);
        template.find('input[name="deleteUserData"]').on('input', function () {
            purge = $(this).is(':checked');
        });
        template.find('input[name="deleteUserHandle"]').on('input', function () {
            confirmHandle = String($(this).val());
        });

        const result = await callGenericPopup(template, POPUP_TYPE.CONFIRM, '', { okButton: 'Delete', cancelButton: 'Cancel', wide: false, large: false });

        if (result !== POPUP_RESULT.AFFIRMATIVE) {
            throw new Error('Delete user cancelled');
        }

        if (handle !== confirmHandle) {
            toastr.error('Handles do not match', 'Failed to delete user');
            throw new Error('Handles do not match');
        }

        const response = await fetch('/api/users/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle, purge }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to delete user');
            throw new Error('Failed to delete user');
        }

        toastr.success('User deleted successfully', 'User Deleted');
        callback();
    } catch (error) {
        console.error('Error deleting user:', error);
    }
}

/**
 * Reset a user's settings.
 * @param {string} handle User handle
 * @param {function} callback Success callback
 */
async function resetSettings(handle, callback) {
    try {
        let password = '';
        const template = $(await renderTemplateAsync('resetSettings'));
        template.find('input[name="password"]').on('input', function () {
            password = String($(this).val());
        });
        const result = await callGenericPopup(template, POPUP_TYPE.CONFIRM, '', { okButton: 'Reset', cancelButton: 'Cancel', wide: false, large: false });

        if (result !== POPUP_RESULT.AFFIRMATIVE) {
            throw new Error('Reset settings cancelled');
        }

        const response = await fetch('/api/users/reset-settings', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle, password }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to reset settings');
            throw new Error('Failed to reset settings');
        }

        toastr.success('Settings reset successfully', 'Settings Reset');
        callback();
    } catch (error) {
        console.error('Error resetting settings:', error);
    }
}

/**
 * Change a user's display name.
 * @param {string} handle User handle
 * @param {string} name Current name
 * @param {function} callback Success callback
 */
async function changeName(handle, name, callback) {
    try {
        const template = $(await renderTemplateAsync('changeName'));
        const result = await callGenericPopup(template, POPUP_TYPE.INPUT, name, { okButton: 'Change', cancelButton: 'Cancel', wide: false, large: false });

        if (!result) {
            throw new Error('Change name cancelled');
        }

        name = String(result);

        const response = await fetch('/api/users/change-name', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ handle, name }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to change name');
            throw new Error('Failed to change name');
        }

        toastr.success('Name changed successfully', 'Name Changed');
        callback();

    } catch (error) {
        console.error('Error changing name:', error);
    }
}

/**
 * Restore a settings snapshot.
 * @param {string} name Snapshot name
 * @param {function} callback Success callback
 */
async function restoreSnapshot(name, callback) {
    try {
        const confirm = await callGenericPopup(
            `Are you sure you want to restore the settings from "${name}"?`,
            POPUP_TYPE.CONFIRM,
            '',
            { okButton: 'Restore', cancelButton: 'Cancel', wide: false, large: false },
        );

        if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
            throw new Error('Restore snapshot cancelled');
        }

        const response = await fetch('/api/settings/restore-snapshot', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to restore snapshot');
            throw new Error('Failed to restore snapshot');
        }

        callback();
    } catch (error) {
        console.error('Error restoring snapshot:', error);
    }

}

/**
 * Load the content of a settings snapshot.
 * @param {string} name Snapshot name
 * @returns {Promise<string>} Snapshot content
 */
async function loadSnapshotContent(name) {
    try {
        const response = await fetch('/api/settings/load-snapshot', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to load snapshot content');
            throw new Error('Failed to load snapshot content');
        }

        return response.text();
    } catch (error) {
        console.error('Error loading snapshot content:', error);
    }
}

/**
 * Gets a list of settings snapshots.
 * @returns {Promise<Snapshot[]>} List of snapshots
 * @typedef {Object} Snapshot
 * @property {string} name Snapshot name
 * @property {number} date Date in milliseconds
 * @property {number} size File size in bytes
 */
async function getSnapshots() {
    try {
        const response = await fetch('/api/settings/get-snapshots', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to get settings snapshots');
            throw new Error('Failed to get settings snapshots');
        }

        const snapshots = await response.json();
        return snapshots;
    } catch (error) {
        console.error('Error getting settings snapshots:', error);
        return [];
    }
}

/**
 * Make a snapshot of the current settings.
 * @param {function} callback Success callback
 * @returns {Promise<void>}
 */
async function makeSnapshot(callback) {
    try {
        const response = await fetch('/api/settings/make-snapshot', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to make snapshot');
            throw new Error('Failed to make snapshot');
        }

        toastr.success('Snapshot created successfully', 'Snapshot Created');
        callback();
    } catch (error) {
        console.error('Error making snapshot:', error);
    }
}

/**
 * Open the settings snapshots view.
 */
async function viewSettingsSnapshots() {
    const template = $(await renderTemplateAsync('snapshotsView'));
    async function renderSnapshots() {
        const snapshots = await getSnapshots();
        template.find('.snapshotList').empty();

        for (const snapshot of snapshots.sort((a, b) => b.date - a.date)) {
            const snapshotBlock = template.find('.snapshotTemplate .snapshot').clone();
            snapshotBlock.find('.snapshotName').text(snapshot.name);
            snapshotBlock.find('.snapshotDate').text(new Date(snapshot.date).toLocaleString());
            snapshotBlock.find('.snapshotSize').text(humanFileSize(snapshot.size));
            snapshotBlock.find('.snapshotRestoreButton').on('click', async (e) => {
                e.stopPropagation();
                restoreSnapshot(snapshot.name, () => location.reload());
            });
            snapshotBlock.find('.inline-drawer-toggle').on('click', async () => {
                const contentBlock = snapshotBlock.find('.snapshotContent');
                if (!contentBlock.val()) {
                    const content = await loadSnapshotContent(snapshot.name);
                    contentBlock.val(content);
                }

            });
            template.find('.snapshotList').append(snapshotBlock);
        }
    }

    callGenericPopup(template, POPUP_TYPE.TEXT, '', { okButton: 'Close', wide: false, large: false, allowVerticalScrolling: true });
    template.find('.makeSnapshotButton').on('click', () => makeSnapshot(renderSnapshots));
    renderSnapshots();
}

/**
 * Reset everything to default.
 * @param {function} callback Success callback
 */
async function resetEverything(callback) {
    try {
        const step1Response = await fetch('/api/users/reset-step1', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!step1Response.ok) {
            const data = await step1Response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to reset');
            throw new Error('Failed to reset everything');
        }

        let password = '';
        let code = '';

        const template = $(await renderTemplateAsync('userReset'));
        template.find('input[name="password"]').on('input', function () {
            password = String($(this).val());
        });
        template.find('input[name="code"]').on('input', function () {
            code = String($(this).val());
        });
        const confirm = await callGenericPopup(
            template,
            POPUP_TYPE.CONFIRM,
            '',
            { okButton: 'Reset', cancelButton: 'Cancel', wide: false, large: false },
        );

        if (confirm !== POPUP_RESULT.AFFIRMATIVE) {
            throw new Error('Reset everything cancelled');
        }

        const step2Response = await fetch('/api/users/reset-step2', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ password, code }),
        });

        if (!step2Response.ok) {
            const data = await step2Response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to reset');
            throw new Error('Failed to reset everything');
        }

        toastr.success('Everything reset successfully', 'Reset Everything');
        callback();
    } catch (error) {
        console.error('Error resetting everything:', error);
    }

}

async function openUserProfile() {
    await getCurrentUser();

    const template = $(await renderTemplateAsync('userProfile'));
    template.find('.userName').text(currentUser.name);
    template.find('.userHandle').text(currentUser.handle);
    template.find('.avatar img').attr('src', currentUser.avatar);
    template.find('.userRole').text(currentUser.admin ? 'Admin' : 'User');
    template.find('.userCreated').text(new Date(currentUser.created).toLocaleString());
    template.find('.hasPassword').toggle(currentUser.password);
    template.find('.noPassword').toggle(!currentUser.password);

    // 显示邮箱信息（如果没有绑定则显示为空）
    const userEmail = currentUser.email || '';
    template.find('.userEmail').text(userEmail);

    // 显示到期时间
    if (currentUser.expiresAt) {
        const expiresDate = new Date(currentUser.expiresAt);
        const now = new Date();
        const daysLeft = Math.ceil((expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        let expiresText = expiresDate.toLocaleString();
        if (daysLeft > 0) {
            expiresText += ` (剩余${daysLeft}天)`;
        } else {
            expiresText += ' (已过期)';
        }
        template.find('.userExpiresAt').text(expiresText);
        if (daysLeft <= 7 && daysLeft > 0) {
            template.find('.userExpiresAt').css('color', 'orange');
        } else if (daysLeft <= 0) {
            template.find('.userExpiresAt').css('color', 'red');
        }
    } else {
        template.find('.userExpiresAt').text('永久');
        template.find('.userExpiresAt').css('color', 'green');
    }

    template.find('.userSettingsSnapshotsButton').on('click', () => viewSettingsSnapshots());
    template.find('.userChangeNameButton').on('click', async () => changeName(currentUser.handle, currentUser.name, async () => {
        await getCurrentUser();
        template.find('.userName').text(currentUser.name);
    }));
    template.find('.userChangePasswordButton').on('click', () => changePassword(currentUser.handle, async () => {
        await getCurrentUser();
        template.find('.hasPassword').toggle(currentUser.password);
        template.find('.noPassword').toggle(!currentUser.password);
    }));

    // 续费按钮事件
    template.find('.userRenewButton').on('click', async () => {
        // 获取购买链接
        let purchaseLink = '';
        try {
            const linkResponse = await fetch('/api/invitation-codes/purchase-link', {
                method: 'GET',
                headers: getRequestHeaders()
            });
            if (linkResponse.ok) {
                const linkData = await linkResponse.json();
                purchaseLink = linkData.purchaseLink || '';
            }
        } catch (error) {
            console.error('获取购买链接失败:', error);
        }

        // 构建提示信息
        let promptMessage = '请输入续费码';
        if (purchaseLink) {
            promptMessage = `请输入续费码\n\n如需购买续费码，请访问：\n${purchaseLink}`;
        }

        const code = await callGenericPopup(promptMessage, POPUP_TYPE.INPUT, '', { okButton: '确认', cancelButton: '取消' });

        if (!code) {
            return;
        }

        try {
            const response = await fetch('/api/users/renew', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ invitationCode: code })
            });

            const data = await response.json();

            if (!response.ok) {
                toastr.error(data.error || '续费失败', '错误');
                return;
            }

            toastr.success(data.message || '续费成功', '成功');

            // 刷新用户信息
            await getCurrentUser();
            if (currentUser.expiresAt) {
                const expiresDate = new Date(currentUser.expiresAt);
                const now = new Date();
                const daysLeft = Math.ceil((expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                let expiresText = expiresDate.toLocaleString();
                if (daysLeft > 0) {
                    expiresText += ` (剩余${daysLeft}天)`;
                }
                template.find('.userExpiresAt').text(expiresText);
                template.find('.userExpiresAt').css('color', daysLeft <= 7 ? 'orange' : '');
            } else {
                template.find('.userExpiresAt').text('永久');
                template.find('.userExpiresAt').css('color', 'green');
            }
        } catch (error) {
            console.error('续费错误:', error);
            toastr.error('续费失败，请稍后重试', '错误');
        }
    });

    template.find('.userBackupButton').on('click', function () {
        $(this).addClass('disabled');
        backupUserData(currentUser.handle, () => {
            $(this).removeClass('disabled');
        });
    });
    template.find('.userResetSettingsButton').on('click', () => resetSettings(currentUser.handle, () => location.reload()));
    template.find('.userResetAllButton').on('click', () => resetEverything(() => location.reload()));
    template.find('.userAvatarChange').on('click', () => template.find('.avatarUpload').trigger('click'));
    template.find('.avatarUpload').on('change', async function () {
        if (!(this instanceof HTMLInputElement)) {
            return;
        }

        const file = this.files[0];
        if (!file) {
            return;
        }

        await cropAndUploadAvatar(currentUser.handle, file);
        await getCurrentUser();
        template.find('.avatar img').attr('src', currentUser.avatar);
    });
    template.find('.userAvatarRemove').on('click', async function () {
        await changeAvatar(currentUser.handle, '');
        await getCurrentUser();
        template.find('.avatar img').attr('src', currentUser.avatar);
    });

    if (!accountsEnabled) {
        template.find('[data-require-accounts]').hide();
        template.find('.accountsDisabledHint').show();
    }

    const popupOptions = {
        okButton: 'Close',
        wide: false,
        large: false,
        allowVerticalScrolling: true,
        allowHorizontalScrolling: false,
    };
    callGenericPopup(template, POPUP_TYPE.TEXT, '', popupOptions);
}

/**
 * Crop and upload an avatar image.
 * @param {string} handle User handle
 * @param {File} file Avatar file
 * @returns {Promise<string>}
 */
async function cropAndUploadAvatar(handle, file) {
    const dataUrl = await getBase64Async(await ensureImageFormatSupported(file));
    const croppedImage = await callGenericPopup('Set the crop position of the avatar image', POPUP_TYPE.CROP, '', { cropAspect: 1, cropImage: dataUrl });
    if (!croppedImage) {
        return;
    }

    await changeAvatar(handle, String(croppedImage));

    return String(croppedImage);
}

/**
 * Change the avatar of the user.
 * @param {string} handle User handle
 * @param {string} avatar File to upload or base64 string
 * @returns {Promise<void>} Avatar URL
 */
async function changeAvatar(handle, avatar) {
    try {
        const response = await fetch('/api/users/change-avatar', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar, handle }),
        });

        if (!response.ok) {
            const data = await response.json();
            toastr.error(data.error || 'Unknown error', 'Failed to change avatar');
            return;
        }
    } catch (error) {
        console.error('Error changing avatar:', error);
    }
}

async function openAdminPanel() {
    // 用户列表分页相关变量
    let currentUserPage = 1;
    const usersPerPage = 20; // 每页显示20个用户
    let userSearchTerm = '';
    let allUsers = []; // 存储所有用户数据

    async function renderUsers() {
        // 先快速加载用户列表（不包含存储大小）
        const users = await getUsers(false);
        allUsers = users; // 保存所有用户数据

        // 应用搜索过滤
        let filteredUsers = users;
        if (userSearchTerm) {
            filteredUsers = users.filter(user =>
                user.name.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
                user.handle.toLowerCase().includes(userSearchTerm.toLowerCase())
            );
        }

        // 计算分页
        const totalPages = Math.ceil(filteredUsers.length / usersPerPage);

        // 如果当前页超出范围，自动调整到最后一页
        if (currentUserPage > totalPages && totalPages > 0) {
            currentUserPage = totalPages;
        } else if (totalPages === 0) {
            currentUserPage = 1;
        }

        const startIndex = (currentUserPage - 1) * usersPerPage;
        const endIndex = startIndex + usersPerPage;
        const pageUsers = filteredUsers.slice(startIndex, endIndex);

        // 清除旧的用户卡片
        template.find('.navTab.usersList .userAccount').remove();

        // 确保有用户列表容器
        let usersListContainer = template.find('.navTab.usersList .usersListContainer');
        if (usersListContainer.length === 0) {
            usersListContainer = $('<div class="usersListContainer"></div>');
            template.find('.navTab.usersList').append(usersListContainer);
        }

        // 存储用户块的引用，用于后续更新存储大小
        const userBlocks = new Map();

        // 添加搜索框和统计信息（确保在 navTab 内部）
        let controlsHtml = template.find('.navTab.usersList .usersListControls');
        if (controlsHtml.length === 0) {
            controlsHtml = $(`
                <div class="usersListControls" style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px; padding: 10px; background: var(--SmartThemeBlurTintColor); border-radius: 10px;">
                    <input type="text" id="userSearchInput" placeholder="搜索用户名或句柄..." value="" class="text_pole" style="flex: 1;">
                    <span class="userCount" style="white-space: nowrap; opacity: 0.7; font-size: 0.9em; padding: 5px 10px; background: var(--black30a); border-radius: 5px;"></span>
                </div>
            `);
            // 插入到 navTab.usersList 的开头（在已有按钮之后）
            const navTab = template.find('.navTab.usersList');
            const existingButtons = navTab.find('.flex-container.justifyCenter').first();
            if (existingButtons.length > 0) {
                existingButtons.after(controlsHtml);
            } else {
                navTab.prepend(controlsHtml);
            }
        }

        controlsHtml.find('#userSearchInput').val(userSearchTerm);
        controlsHtml.find('.userCount').text(`显示 ${startIndex + 1}-${Math.min(endIndex, filteredUsers.length)} / ${filteredUsers.length} 个用户`);

        // 绑定搜索事件（使用防抖）
        controlsHtml.find('#userSearchInput').off('input').on('input', debounceSearch(function() {
            userSearchTerm = $(this).val().trim();
            currentUserPage = 1; // 重置到第一页
            renderUsers();
        }, 300));

        // 如果没有用户，显示提示
        if (filteredUsers.length === 0) {
            const emptyMessage = userSearchTerm
                ? `<div style="text-align: center; padding: 40px; opacity: 0.7;">没有找到匹配的用户</div>`
                : `<div style="text-align: center; padding: 40px; opacity: 0.7;">暂无用户</div>`;
            usersListContainer.append(emptyMessage);
            return;
        }

        for (const user of pageUsers) {
            const userBlock = template.find('.userAccountTemplate .userAccount').clone();
            userBlock.find('.userName').text(user.name);
            userBlock.find('.userHandle').text(user.handle);
            userBlock.find('.userStatus').text(user.enabled ? 'Enabled' : 'Disabled');
            userBlock.find('.userRole').text(user.admin ? 'Admin' : 'User');
            userBlock.find('.avatar img').attr('src', user.avatar);
            userBlock.find('.hasPassword').toggle(user.password);
            userBlock.find('.noPassword').toggle(!user.password);
            userBlock.find('.userCreated').text(new Date(user.created).toLocaleString());

            // 初始显示"加载中..."
            userBlock.find('.userStorageSize').text('加载中...');

            // 保存userBlock引用
            userBlocks.set(user.handle, userBlock);

            // 显示到期时间
            if (user.expiresAt) {
                const expiresDate = new Date(user.expiresAt);
                const now = new Date();
                const daysLeft = Math.ceil((expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                let expiresText = expiresDate.toLocaleString();
                if (daysLeft > 0) {
                    expiresText += ` (剩余${daysLeft}天)`;
                } else {
                    expiresText += ' (已过期)';
                }
                userBlock.find('.userExpiresAt').text(expiresText);
                if (daysLeft <= 7 && daysLeft > 0) {
                    userBlock.find('.userExpiresAt').css('color', 'orange');
                } else if (daysLeft <= 0) {
                    userBlock.find('.userExpiresAt').css('color', 'red');
                }
            } else {
                userBlock.find('.userExpiresAt').text('永久');
                userBlock.find('.userExpiresAt').css('color', 'green');
            }

            userBlock.find('.userEnableButton').toggle(!user.enabled).on('click', () => enableUser(user.handle, renderUsers));
            userBlock.find('.userDisableButton').toggle(user.enabled).on('click', () => disableUser(user.handle, renderUsers));
            userBlock.find('.userPromoteButton').toggle(!user.admin).on('click', () => promoteUser(user.handle, renderUsers));
            userBlock.find('.userDemoteButton').toggle(user.admin).on('click', () => demoteUser(user.handle, renderUsers));
            userBlock.find('.userChangePasswordButton').on('click', () => changePassword(user.handle, renderUsers));
            userBlock.find('.userClearBackupsButton').on('click', () => clearUserBackups(user.handle, renderUsers));
            userBlock.find('.userDelete').on('click', () => deleteUser(user.handle, renderUsers));
            userBlock.find('.userChangeNameButton').on('click', async () => changeName(user.handle, user.name, renderUsers));
            userBlock.find('.userBackupButton').on('click', function () {
                $(this).addClass('disabled').off('click');
                backupUserData(user.handle, renderUsers);
            });
            userBlock.find('.userAvatarChange').on('click', () => userBlock.find('.avatarUpload').trigger('click'));
            userBlock.find('.avatarUpload').on('change', async function () {
                if (!(this instanceof HTMLInputElement)) {
                    return;
                }

                const file = this.files[0];
                if (!file) {
                    return;
                }

                await cropAndUploadAvatar(user.handle, file);
                renderUsers();
            });
            userBlock.find('.userAvatarRemove').on('click', async function () {
                await changeAvatar(user.handle, '');
                renderUsers();
            });
            usersListContainer.append(userBlock);
        }

        // 添加底部分页控件（添加到 .navTab.usersList 内部，而不是外部）
        let paginationBottom = template.find('.navTab.usersList .usersPaginationBottom');
        if (paginationBottom.length === 0) {
            paginationBottom = $('<div class="usersPaginationBottom"></div>');
            template.find('.navTab.usersList').append(paginationBottom);
        }
        paginationBottom.html(createUserPaginationControls(currentUserPage, totalPages, filteredUsers.length));

        // 绑定分页按钮事件
        bindUserPaginationEvents();

        // 异步批量加载当前页用户的存储大小
        if (pageUsers.length > 0) {
            const userHandles = pageUsers.map(u => u.handle);

            // 分批加载，避免一次性加载太多用户导致请求超时
            // 每批最多处理20个用户
            const batchSize = 20;
            for (let i = 0; i < userHandles.length; i += batchSize) {
                const batch = userHandles.slice(i, i + batchSize);

                // 延迟一点时间，让UI先渲染出来
                if (i === 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                try {
                    const storageSizes = await getUsersStorageSize(batch);

                    // 更新UI显示
                    for (const handle of batch) {
                        const userBlock = userBlocks.get(handle);
                        if (userBlock && storageSizes[handle]) {
                            if (storageSizes[handle].storageSize !== undefined) {
                                userBlock.find('.userStorageSize').text(humanFileSize(storageSizes[handle].storageSize));
                            } else if (storageSizes[handle].error) {
                                userBlock.find('.userStorageSize').text('计算失败');
                                userBlock.find('.userStorageSize').attr('title', storageSizes[handle].error);
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Error loading storage size for batch ${i / batchSize + 1}:`, error);
                    // 如果某批次失败，标记为错误
                    for (const handle of batch) {
                        const userBlock = userBlocks.get(handle);
                        if (userBlock) {
                            userBlock.find('.userStorageSize').text('加载失败');
                        }
                    }
                }
            }
        }
    }

    // 创建用户分页控件
    function createUserPaginationControls(currentPage, totalPages, totalUsers) {
        if (totalPages <= 1) return '';

        let html = '<div class="userPaginationControls" style="display: flex; align-items: center; justify-content: center; gap: 10px; margin: 15px 0; flex-wrap: wrap;">';

        // 上一页按钮
        if (currentPage > 1) {
            html += `<button class="menu_button user-pagination-btn" data-page="${currentPage - 1}">
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
            html += `<button class="menu_button user-pagination-btn" data-page="1">1</button>`;
            if (startPage > 2) {
                html += `<span style="opacity: 0.5;">...</span>`;
            }
        }

        // 中间页码
        for (let i = startPage; i <= endPage; i++) {
            if (i === currentPage) {
                html += `<button class="menu_button" disabled style="background: var(--SmartThemeBlurTintColor);">${i}</button>`;
            } else {
                html += `<button class="menu_button user-pagination-btn" data-page="${i}">${i}</button>`;
            }
        }

        // 最后一页
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                html += `<span style="opacity: 0.5;">...</span>`;
            }
            html += `<button class="menu_button user-pagination-btn" data-page="${totalPages}">${totalPages}</button>`;
        }

        // 下一页按钮
        if (currentPage < totalPages) {
            html += `<button class="menu_button user-pagination-btn" data-page="${currentPage + 1}">
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

    // 绑定用户分页按钮事件
    function bindUserPaginationEvents() {
        template.find('.user-pagination-btn').off('click').on('click', function() {
            currentUserPage = parseInt($(this).data('page'));
            renderUsers();

            // 滚动到顶部
            const usersListControls = template.find('.usersListControls');
            if (usersListControls.length > 0) {
                usersListControls[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }

    // 防抖函数
    function debounceSearch(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    const template = $(await renderTemplateAsync('admin'));

    template.find('.adminNav > button').on('click', function () {
        const target = String($(this).data('target-tab'));
        template.find('.navTab').each(function () {
            $(this).toggle(this.classList.contains(target));
        });
        // 初始化管理员扩展功能
        if (typeof window.initializeAdminExtensions === 'function') {
            setTimeout(() => {
                window.initializeAdminExtensions();
            }, 100);
        }
    });
// 管理员面板打开时立即初始化扩展功能
if (typeof window.initializeAdminExtensions === 'function') {
    setTimeout(() => {
        window.initializeAdminExtensions();
    }, 200);
}
    template.find('.createUserDisplayName').on('input', async function () {
        const slug = await slugify(String($(this).val()));
        template.find('.createUserHandle').val(slug);
    });

    template.find('.userCreateForm').on('submit', function (event) {
        if (!(event.target instanceof HTMLFormElement)) {
            return;
        }

        event.preventDefault();
        createUser(event.target, () => {
            template.find('.manageUsersButton').trigger('click');
            currentUserPage = 1; // 重置到第一页以显示新创建的用户
            userSearchTerm = ''; // 清空搜索词
            renderUsers();
        });
    });

    // 绑定一键清理所有用户备份文件按钮
    template.find('.clearAllBackupsButton').on('click', () => clearAllBackups(renderUsers));

    // 绑定一键删除30天未登录用户按钮
    template.find('.deleteInactiveUsersButton').on('click', () => deleteInactiveUsers(renderUsers));

    callGenericPopup(template, POPUP_TYPE.TEXT, '', { okButton: 'Close', wide: true, large: true, allowVerticalScrolling: true, allowHorizontalScrolling: true });

    renderUsers();
}

/**
 * Log out the current user.
 * @returns {Promise<void>}
 */
async function logout() {
    try {
        // 先停止用户心跳，防止在登出过程中发送心跳请求
        if (typeof window.userHeartbeat !== 'undefined' && window.userHeartbeat.stop) {
            window.userHeartbeat.stop();
        }

        // 发送登出请求
    await fetch('/api/users/logout', {
        method: 'POST',
        headers: getRequestHeaders(),
    });
} catch (error) {
    console.warn('Logout request failed:', error);
    // 即使登出请求失败，也继续执行页面跳转
}
    // On an explicit logout stop auto login
    // to allow user to change username even
    // when auto auth (such as authelia or basic)
    // would be valid
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.set('noauto', 'true');

    window.location.search = urlParams.toString();
}

/**
 * Runs a text through the slugify API endpoint.
 * @param {string} text Text to slugify
 * @returns {Promise<string>} Slugified text
 */
async function slugify(text) {
    try {
        const response = await fetch('/api/users/slugify', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ text }),
        });

        if (!response.ok) {
            throw new Error('Failed to slugify text');
        }

        return response.text();
    } catch (error) {
        console.error('Error slugifying text:', error);
        return text;
    }
}

/**
 * Pings the server to extend the user session.
 */
async function extendUserSession() {
    try {
        const response = await fetch('/api/ping?extend=1', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            throw new Error('Ping did not succeed', { cause: response.status });
        }
    } catch (error) {
        console.error('Failed to extend user session', error);
    }
}

jQuery(() => {
    $('#logout_button').on('click', () => {
        logout();
    });
    $('#admin_button').on('click', () => {
        openAdminPanel();
    });
    $('#account_button').on('click', () => {
        openUserProfile();
    });
    setInterval(async () => {
        if (currentUser) {
            await extendUserSession();
        }
    }, SESSION_EXTEND_INTERVAL);
});
