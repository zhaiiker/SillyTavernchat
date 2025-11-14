import crypto from 'node:crypto';

import storage from 'node-persist';
import express from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { getIpFromRequest, getRealIpFromHeader } from '../express-common.js';
import { color, Cache, getConfigValue } from '../util.js';
import { KEY_PREFIX, getUserAvatar, toKey, getPasswordHash, getPasswordSalt, getAllUserHandles, getUserDirectories, ensurePublicDirectoriesExist, normalizeHandle } from '../users.js';
import { validateInvitationCode, useInvitationCode, getPurchaseLink, isInvitationCodesEnabled } from '../invitation-codes.js';
import { checkForNewContent, CONTENT_TYPES } from './content-manager.js';
import systemMonitor from '../system-monitor.js';
import { isEmailServiceAvailable, sendVerificationCode, sendPasswordRecoveryCode } from '../email-service.js';

const DISCREET_LOGIN = getConfigValue('enableDiscreetLogin', false, 'boolean');
const PREFER_REAL_IP_HEADER = getConfigValue('rateLimiting.preferRealIpHeader', false, 'boolean');
const MFA_CACHE = new Cache(5 * 60 * 1000);
const VERIFICATION_CODE_CACHE = new Cache(5 * 60 * 1000); // 验证码缓存，5分钟有效

const getIpAddress = (request) => PREFER_REAL_IP_HEADER ? getRealIpFromHeader(request) : getIpFromRequest(request);

export const router = express.Router();
const loginLimiter = new RateLimiterMemory({
    points: 5,
    duration: 60,
});
const recoverLimiter = new RateLimiterMemory({
    points: 5,
    duration: 300,
});
const registerLimiter = new RateLimiterMemory({
    points: 3,
    duration: 300,
});
const sendVerificationLimiter = new RateLimiterMemory({
    points: 3,
    duration: 300,
});

/**
 * 判断用户名是否过于随意/简单，不允许注册。
 * 规则：
 * - 长度小于3
 * - 纯数字且长度>=3
 * - 单字符重复3次及以上（如 aaa, 1111）
 * - 常见随意/弱用户名列表
 */
function isTrivialHandle(handle) {
    if (!handle) return true;
    const h = String(handle).toLowerCase().replace(/-/g, ''); // 移除横杠后判断

    // 长度太短
    if (h.length < 3) return true;

    // 纯数字，长度>=3
    if (/^\d{3,}$/.test(h)) return true;

    // 单字符重复3次及以上
    if (/^(.)\1{2,}$/.test(h)) return true;

    // 常见随意用户名/弱用户名集合
    const banned = new Set([
        '123', '1234', '12345', '123456', '000', '0000', '111', '1111',
        'qwe', 'qwer', 'qwert', 'qwerty', 'asdf', 'zxc', 'zxcv', 'zxcvb', 'qaz', 'qazwsx',
        'test', 'tester', 'testing', 'guest', 'user', 'username', 'admin', 'root', 'null', 'void',
        'abc', 'abcd', 'abcdef',
    ]);
    if (banned.has(h)) return true;
    return false;
}

router.post('/list', async (_request, response) => {
    try {
        if (DISCREET_LOGIN) {
            return response.sendStatus(204);
        }

        /** @type {import('../users.js').User[]} */
        const users = await storage.values(x => x.key.startsWith(KEY_PREFIX));

        /** @type {Promise<import('../users.js').UserViewModel>[]} */
        const viewModelPromises = users
            .filter(x => x.enabled)
            .map(user => new Promise(async (resolve) => {
                getUserAvatar(user.handle).then(avatar =>
                    resolve({
                        handle: user.handle,
                        name: user.name,
                        created: user.created,
                        avatar: avatar,
                        password: !!user.password,
                    }),
                );
            }));

        const viewModels = await Promise.all(viewModelPromises);
        viewModels.sort((x, y) => (x.created ?? 0) - (y.created ?? 0));
        return response.json(viewModels);
    } catch (error) {
        console.error('User list failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/login', async (request, response) => {
    try {
        if (!request.body.handle) {
            console.warn('Login failed: Missing required fields');
            return response.status(400).json({ error: '缺少必填字段' });
        }

        const ip = getIpAddress(request);
        await loginLimiter.consume(ip);

        // 规范化用户名
        const normalizedHandle = normalizeHandle(request.body.handle);

        if (!normalizedHandle) {
            console.warn('Login failed: Invalid handle format');
            return response.status(400).json({ error: '用户名格式无效' });
        }

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(normalizedHandle));

        if (!user) {
            console.error('Login failed: User', request.body.handle, 'not found');
            return response.status(403).json({ error: '用户名或密码错误' });
        }

        if (!user.enabled) {
            console.warn('Login failed: User', user.handle, 'is disabled');
            return response.status(403).json({ error: '用户已被禁用' });
        }

        // 检查用户是否过期
        if (user.expiresAt && user.expiresAt < Date.now()) {
            console.warn('Login failed: User', user.handle, 'subscription expired');
            const purchaseLink = await getPurchaseLink();
            return response.status(403).json({
                error: '您的账户已到期，请续费后再使用',
                expired: true,
                purchaseLink: purchaseLink || '',
            });
        }

        if (user.password && user.password !== getPasswordHash(request.body.password, user.salt)) {
            console.warn('Login failed: Incorrect password for', user.handle);
            return response.status(403).json({ error: '用户名或密码错误' });
        }

        if (!request.session) {
            console.error('Session not available');
            return response.sendStatus(500);
        }

        await loginLimiter.delete(ip);
        request.session.handle = user.handle;

        // 记录用户登录到系统监控器
        systemMonitor.recordUserLogin(user.handle, { userName: user.name });

        console.info('Login successful:', user.handle, 'from', ip, 'at', new Date().toLocaleString());
        return response.json({ handle: user.handle });
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Login failed: Rate limited from', getIpAddress(request));
            return response.status(429).send({ error: '尝试次数过多，请稍后重试或恢复密码' });
        }

        console.error('Login failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/logout', async (request, response) => {
    try {
        if (!request.session) {
            return response.sendStatus(200);
        }

        const userHandle = request.session.handle;
        if (userHandle) {
            // 记录用户登出到系统监控器
            systemMonitor.recordUserLogout(userHandle);
            console.info('Logout successful:', userHandle, 'at', new Date().toLocaleString());
        }

        // 清除会话
        request.session = null;
        return response.sendStatus(200);
    } catch (error) {
        console.error('Logout failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/heartbeat', async (request, response) => {
    try {
        if (!request.session || !request.session.handle) {
            return response.status(401).json({ error: 'Not authenticated' });
        }

        const userHandle = request.session.handle;
        const user = await storage.getItem(toKey(userHandle));

        if (!user) {
            return response.status(401).json({ error: 'User not found' });
        }

        // 更新用户活动状态
        systemMonitor.updateUserActivity(userHandle, {
            userName: user.name,
            isHeartbeat: true,
        });

        // 更新session的最后活动时间
        request.session.lastActivity = Date.now();

        return response.json({ status: 'ok', timestamp: Date.now() });
    } catch (error) {
        console.error('Heartbeat failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/send-verification', async (request, response) => {
    try {
        if (!request.body.email || !request.body.userName) {
            console.warn('Send verification failed: Missing required fields');
            return response.status(400).json({ error: '缺少必填字段' });
        }

        const ip = getIpAddress(request);
        await sendVerificationLimiter.consume(ip);

        // 检查邮件服务是否可用
        if (!isEmailServiceAvailable()) {
            console.error('Send verification failed: Email service not available');
            return response.status(503).json({ error: '邮件服务未启用，请联系管理员' });
        }

        const email = request.body.email.toLowerCase().trim();
        const userName = request.body.userName.trim();

        // 生成6位数字验证码
        const verificationCode = String(crypto.randomInt(100000, 999999));

        // 将验证码存入缓存，key为邮箱地址
        VERIFICATION_CODE_CACHE.set(email, verificationCode);

        // 发送验证码邮件
        const sent = await sendVerificationCode(email, verificationCode, userName);

        if (!sent) {
            console.error('Send verification failed: Failed to send email to', email);
            return response.status(500).json({ error: '发送邮件失败，请稍后重试' });
        }

        console.info('Verification code sent to', email);
        await sendVerificationLimiter.delete(ip);
        return response.json({ success: true });
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Send verification failed: Rate limited from', getIpAddress(request));
            return response.status(429).send({ error: '发送次数过多，请稍后重试' });
        }

        console.error('Send verification failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/recover-step1', async (request, response) => {
    try {
        if (!request.body.handle) {
            console.warn('Recover step 1 failed: Missing required fields');
            return response.status(400).json({ error: '缺少必填字段' });
        }

        const ip = getIpAddress(request);
        await recoverLimiter.consume(ip);

        // 规范化用户名
        const normalizedHandle = normalizeHandle(request.body.handle);

        if (!normalizedHandle) {
            console.warn('Recover step 1 failed: Invalid handle format');
            return response.status(400).json({ error: '用户名格式无效' });
        }

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(normalizedHandle));

        if (!user) {
            console.error('Recover step 1 failed: User', request.body.handle, 'not found');
            return response.status(404).json({ error: '用户不存在' });
        }

        if (!user.enabled) {
            console.error('Recover step 1 failed: User', user.handle, 'is disabled');
            return response.status(403).json({ error: '用户已被禁用' });
        }

        // 检查用户是否绑定了邮箱
        if (!user.email) {
            console.error('Recover step 1 failed: User', user.handle, 'has no email');
            return response.status(400).json({ error: '该账户未绑定邮箱，无法通过邮箱找回密码。请联系管理员。' });
        }

        const mfaCode = String(crypto.randomInt(1000, 9999));

        // 尝试通过邮件发送恢复码
        if (isEmailServiceAvailable()) {
            const sent = await sendPasswordRecoveryCode(user.email, mfaCode, user.name);
            if (sent) {
                console.info('Password recovery code sent to email:', user.email);
                MFA_CACHE.set(user.handle, mfaCode);
                await recoverLimiter.delete(ip);
                return response.json({
                    success: true,
                    method: 'email',
                    message: '密码恢复码已发送至您的邮箱',
                });
            } else {
                console.error('Failed to send recovery code to email, falling back to console');
            }
        }

        // 如果邮件服务不可用或发送失败，回退到控制台输出
        console.log();
        console.log(color.blue(`${user.name}, your password recovery code is: `) + color.magenta(mfaCode));
        console.log();
        MFA_CACHE.set(user.handle, mfaCode);
        await recoverLimiter.delete(ip);
        return response.json({
            success: true,
            method: 'console',
            message: '密码恢复码已显示在服务器控制台，请联系管理员获取',
        });
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Recover step 1 failed: Rate limited from', getIpAddress(request));
            return response.status(429).send({ error: '尝试次数过多，请稍后重试或联系管理员' });
        }

        console.error('Recover step 1 failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/recover-step2', async (request, response) => {
    try {
        if (!request.body.handle || !request.body.code) {
            console.warn('Recover step 2 failed: Missing required fields');
            return response.status(400).json({ error: '缺少必填字段' });
        }

        // 规范化用户名
        const normalizedHandle = normalizeHandle(request.body.handle);

        if (!normalizedHandle) {
            console.warn('Recover step 2 failed: Invalid handle format');
            return response.status(400).json({ error: '用户名格式无效' });
        }

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(normalizedHandle));
        const ip = getIpAddress(request);

        if (!user) {
            console.error('Recover step 2 failed: User', request.body.handle, 'not found');
            return response.status(404).json({ error: '用户不存在' });
        }

        if (!user.enabled) {
            console.warn('Recover step 2 failed: User', user.handle, 'is disabled');
            return response.status(403).json({ error: '用户已被禁用' });
        }

        const mfaCode = MFA_CACHE.get(user.handle);

        if (request.body.code !== mfaCode) {
            await recoverLimiter.consume(ip);
            console.warn('Recover step 2 failed: Incorrect code');
            return response.status(403).json({ error: '恢复码错误' });
        }

        if (request.body.newPassword) {
            const salt = getPasswordSalt();
            user.password = getPasswordHash(request.body.newPassword, salt);
            user.salt = salt;
            await storage.setItem(toKey(normalizedHandle), user);
        } else {
            user.password = '';
            user.salt = '';
            await storage.setItem(toKey(normalizedHandle), user);
        }

        await recoverLimiter.delete(ip);
        MFA_CACHE.remove(user.handle);
        return response.sendStatus(204);
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Recover step 2 failed: Rate limited from', getIpAddress(request));
            return response.status(429).send({ error: '尝试次数过多，请稍后重试或联系管理员' });
        }

        console.error('Recover step 2 failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/register', async (request, response) => {
    try {
        const { handle, name, password, confirmPassword, email, verificationCode, invitationCode } = request.body;

        if (!handle || !name || !password || !confirmPassword) {
            console.warn('Register failed: Missing required fields');
            return response.status(400).json({ error: '请填写所有必填字段' });
        }

        let normalizedEmail = null;

        // 只有邮件服务启用时才验证邮箱和验证码
        if (isEmailServiceAvailable()) {
            if (!email || !verificationCode) {
                console.warn('Register failed: Missing email or verification code');
                return response.status(400).json({ error: '请填写邮箱和验证码' });
            }

            // 验证邮箱格式
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                console.warn('Register failed: Invalid email format');
                return response.status(400).json({ error: '邮箱格式不正确' });
            }

            // 验证验证码
            normalizedEmail = email.toLowerCase().trim();
            const cachedCode = VERIFICATION_CODE_CACHE.get(normalizedEmail);

            if (!cachedCode) {
                console.warn('Register failed: Verification code expired or not found');
                return response.status(400).json({ error: '验证码已过期或不存在，请重新发送' });
            }

            if (cachedCode !== verificationCode) {
                console.warn('Register failed: Incorrect verification code');
                return response.status(400).json({ error: '验证码错误' });
            }
        } else if (email) {
            // 即使邮件服务未启用，如果用户提供了邮箱，也保存它
            normalizedEmail = email.toLowerCase().trim();
        }

        if (password !== confirmPassword) {
            console.warn('Register failed: Password mismatch');
            return response.status(400).json({ error: '两次输入的密码不一致' });
        }

        if (password.length < 6) {
            console.warn('Register failed: Password too short');
            return response.status(400).json({ error: '密码长度至少6位' });
        }

        const ip = getIpAddress(request);
        await registerLimiter.consume(ip);

        // 验证邀请码（如果启用）
        const invitationValidation = await validateInvitationCode(invitationCode);
        if (!invitationValidation.valid) {
            console.warn('Register failed: Invalid invitation code');
            return response.status(400).json({ error: invitationValidation.reason || '邀请码无效' });
        }

        const handles = await getAllUserHandles();
        // 规范化用户名：支持英文大小写、数字和横杠
        const normalizedHandle = normalizeHandle(handle);

        if (!normalizedHandle) {
            console.warn('Register failed: Invalid handle');
            return response.status(400).json({ error: '用户名无效，仅支持英文、数字和横杠' });
        }

        // 验证用户名格式：只包含字母、数字和横杠
        if (!/^[a-z0-9-]+$/.test(normalizedHandle)) {
            console.warn('Register failed: Handle contains invalid characters:', normalizedHandle);
            return response.status(400).json({ error: '用户名只能包含字母、数字和横杠' });
        }

        // 限制随意/弱用户名
        if (isTrivialHandle(normalizedHandle)) {
            console.warn('Register failed: Trivial/weak handle not allowed:', normalizedHandle);
            return response.status(400).json({ error: '用户名过于简单或在黑名单中，请使用更有辨识度的用户名' });
        }

        if (handles.some(x => x === normalizedHandle)) {
            console.warn('Register failed: User with that handle already exists');
            return response.status(409).json({ error: '该用户名已存在' });
        }

        const salt = getPasswordSalt();
        const hashedPassword = getPasswordHash(password, salt);

        // 计算用户过期时间
        let userExpiresAt = null;
        // 只有在邀请码功能启用且提供了邀请码时，才根据邀请码设置过期时间
        if (isInvitationCodesEnabled() && invitationCode) {
            const invitationValidationResult = await validateInvitationCode(invitationCode);
            if (invitationValidationResult.valid && invitationValidationResult.invitation) {
                const invitation = invitationValidationResult.invitation;
                if (invitation.durationDays !== null && invitation.durationDays > 0) {
                    userExpiresAt = Date.now() + (invitation.durationDays * 24 * 60 * 60 * 1000);
                }
                // durationDays为null表示永久，userExpiresAt保持null
            }
        }
        // 如果邀请码功能关闭，则 userExpiresAt 保持为 null（永久账户）

        const newUser = {
            handle: normalizedHandle,
            name: name.trim(),
            created: Date.now(),
            password: hashedPassword,
            salt: salt,
            admin: false,
            enabled: true,
            expiresAt: userExpiresAt,
        };

        // 只有在有邮箱时才保存
        if (normalizedEmail) {
            newUser.email = normalizedEmail;
        }

        await storage.setItem(toKey(normalizedHandle), newUser);

        // 清除已使用的验证码（如果使用了邮件验证）
        if (normalizedEmail && isEmailServiceAvailable()) {
            VERIFICATION_CODE_CACHE.remove(normalizedEmail);
        }

        // 使用邀请码（如果邀请码功能启用且提供了邀请码）
        if (isInvitationCodesEnabled() && invitationCode) {
            await useInvitationCode(invitationCode, normalizedHandle, userExpiresAt);
        }

        // Create user directories
        console.info('Creating data directories for', newUser.handle);
        await ensurePublicDirectoriesExist();
        const directories = getUserDirectories(newUser.handle);
        await checkForNewContent([directories], [CONTENT_TYPES.SETTINGS]);

        await registerLimiter.delete(ip);
        console.info('User registered successfully:', newUser.handle, 'from', ip);

        // 返回规范化后的用户名，让用户知道真实的用户名
        return response.json({
            handle: newUser.handle,
            message: handle !== normalizedHandle
                ? `注册成功！您的用户名已规范化为: ${normalizedHandle}`
                : '注册成功！'
        });
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Register failed: Rate limited from', getIpAddress(request));
            return response.status(429).send({ error: '尝试次数过多，请稍后重试' });
        }

        console.error('Register failed:', error);
        return response.sendStatus(500);
    }
});

// 获取当前用户信息
router.get('/me', async (request, response) => {
    try {
        if (!request.session || !request.session.handle) {
            return response.status(401).json({ error: '未登录' });
        }

        const userHandle = request.session.handle;
        const user = await storage.getItem(toKey(userHandle));

        if (!user) {
            return response.status(401).json({ error: '用户不存在' });
        }

        // 获取用户头像
        const avatar = await getUserAvatar(user.handle);

        // 返回用户完整信息
        return response.json({
            handle: user.handle,
            name: user.name,
            admin: user.admin || false,
            enabled: user.enabled,
            created: user.created,
            avatar: avatar,
            password: !!user.password,
            expiresAt: user.expiresAt || null,
            email: user.email || null,
        });
    } catch (error) {
        console.error('Get current user failed:', error);
        return response.sendStatus(500);
    }
});

// 用户续费接口（已登录用户）
router.post('/renew', async (request, response) => {
    try {
        if (!request.session || !request.session.handle) {
            return response.status(401).json({ error: '未登录' });
        }

        const { invitationCode } = request.body;

        if (!invitationCode) {
            console.warn('Renew failed: Missing invitation code');
            return response.status(400).json({ error: '请输入续费码' });
        }

        const userHandle = request.session.handle;
        const user = await storage.getItem(toKey(userHandle));

        if (!user) {
            return response.status(401).json({ error: '用户不存在' });
        }

        // 验证邀请码
        const invitationValidation = await validateInvitationCode(invitationCode);
        if (!invitationValidation.valid) {
            console.warn('Renew failed: Invalid invitation code');
            return response.status(400).json({ error: invitationValidation.reason || '续费码无效' });
        }

        const invitation = invitationValidation.invitation;
        if (!invitation) {
            return response.status(400).json({ error: '续费码无效' });
        }

        // 计算新的过期时间
        let newExpiresAt = null;
        if (invitation.durationDays !== null && invitation.durationDays > 0) {
            const baseTime = user.expiresAt && user.expiresAt > Date.now() ? user.expiresAt : Date.now();
            newExpiresAt = baseTime + (invitation.durationDays * 24 * 60 * 60 * 1000);
        }
        // durationDays为null表示永久，newExpiresAt保持null

        user.expiresAt = newExpiresAt;
        await storage.setItem(toKey(userHandle), user);

        // 标记邀请码为已使用，并记录用户到期时间
        await useInvitationCode(invitationCode, userHandle, newExpiresAt);

        console.info('User renewed successfully:', userHandle, 'new expires:', newExpiresAt ? new Date(newExpiresAt).toLocaleString() : '永久');
        return response.json({
            success: true,
            expiresAt: newExpiresAt,
            message: newExpiresAt ? '续费成功，到期时间：' + new Date(newExpiresAt).toLocaleString() : '续费成功，您的账户已升级为永久账户',
        });
    } catch (error) {
        console.error('Renew failed:', error);
        return response.status(500).json({ error: '续费失败，请稍后重试' });
    }
});

// 用户续费接口（未登录用户 - 过期账户续费）
router.post('/renew-expired', async (request, response) => {
    try {
        const { handle, password, invitationCode } = request.body;

        if (!handle || !password) {
            return response.status(400).json({ error: '请提供用户名和密码' });
        }

        if (!invitationCode) {
            console.warn('Renew-expired failed: Missing invitation code');
            return response.status(400).json({ error: '请输入续费码' });
        }

        // 验证用户身份 - 规范化用户名
        const normalizedHandle = normalizeHandle(handle);

        if (!normalizedHandle) {
            return response.status(400).json({ error: '用户名格式无效' });
        }

        const user = await storage.getItem(toKey(normalizedHandle));

        if (!user) {
            return response.status(401).json({ error: '用户名或密码错误' });
        }

        // 验证密码
        const passwordHash = getPasswordHash(password, user.salt);
        if (user.password !== passwordHash) {
            console.warn('Renew-expired failed: Invalid password for', normalizedHandle);
            return response.status(401).json({ error: '用户名或密码错误' });
        }

        // 验证邀请码
        const invitationValidation = await validateInvitationCode(invitationCode);
        if (!invitationValidation.valid) {
            console.warn('Renew-expired failed: Invalid invitation code');
            return response.status(400).json({ error: invitationValidation.reason || '续费码无效' });
        }

        const invitation = invitationValidation.invitation;
        if (!invitation) {
            return response.status(400).json({ error: '续费码无效' });
        }

        // 计算新的过期时间
        let newExpiresAt = null;
        if (invitation.durationDays !== null && invitation.durationDays > 0) {
            const baseTime = user.expiresAt && user.expiresAt > Date.now() ? user.expiresAt : Date.now();
            newExpiresAt = baseTime + (invitation.durationDays * 24 * 60 * 60 * 1000);
        }
        // durationDays为null表示永久，newExpiresAt保持null

        user.expiresAt = newExpiresAt;
        await storage.setItem(toKey(normalizedHandle), user);

        // 标记邀请码为已使用，并记录用户到期时间
        await useInvitationCode(invitationCode, normalizedHandle, newExpiresAt);

        console.info('User renewed successfully (expired account):', normalizedHandle, 'new expires:', newExpiresAt ? new Date(newExpiresAt).toLocaleString() : '永久');
        return response.json({
            success: true,
            expiresAt: newExpiresAt,
            message: newExpiresAt ? '续费成功，到期时间：' + new Date(newExpiresAt).toLocaleString() : '续费成功，您的账户已升级为永久账户',
        });
    } catch (error) {
        console.error('Renew-expired failed:', error);
        return response.status(500).json({ error: '续费失败，请稍后重试' });
    }
});
