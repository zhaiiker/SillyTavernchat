import storage from 'node-persist';
import crypto from 'node:crypto';
import { getConfigValue } from './util.js';

const INVITATION_PREFIX = 'invitation:';
const PURCHASE_LINK_KEY = 'invitation:purchaseLink';
const ENABLE_INVITATION_CODES = getConfigValue('enableInvitationCodes', false, 'boolean');

/**
 * @typedef {Object} InvitationCode
 * @property {string} code - 邀请码
 * @property {string} createdBy - 创建者用户句柄
 * @property {number} createdAt - 创建时间戳
 * @property {boolean} used - 是否已使用
 * @property {string | null} usedBy - 使用者用户句柄（如果已使用）
 * @property {number | null} usedAt - 使用时间戳（如果已使用）
 * @property {string} durationType - 有效期类型：'1day'|'1week'|'1month'|'1quarter'|'6months'|'1year'|'permanent'
 * @property {number | null} durationDays - 有效期天数（如果是永久则为null）
 * @property {number | null} userExpiresAt - 使用该邀请码的用户到期时间（使用后设置）
 */

/**
 * 生成邀请码key
 * @param {string} code 邀请码
 * @returns {string} 存储key
 */
function toInvitationKey(code) {
    return `${INVITATION_PREFIX}${code}`;
}

/**
 * 生成随机邀请码
 * @returns {string} 邀请码
 */
function generateInvitationCode() {
    return crypto.randomBytes(8).toString('hex').toUpperCase();
}

/**
 * 根据有效期类型获取天数
 * @param {string} durationType 有效期类型
 * @returns {number | null} 天数（永久返回null）
 */
function getDurationDays(durationType) {
    const durationMap = {
        '1day': 1,
        '1week': 7,
        '1month': 30,
        '1quarter': 90,
        '6months': 180,
        '1year': 365,
        'permanent': null,
    };
    return durationMap[durationType] ?? null;
}

/**
 * 创建邀请码
 * @param {string} createdBy 创建者用户句柄
 * @param {string} durationType 有效期类型：'1day'|'1week'|'1month'|'1quarter'|'6months'|'1year'|'permanent'
 * @returns {Promise<InvitationCode>} 创建的邀请码对象
 */
export async function createInvitationCode(createdBy, durationType = 'permanent') {
    if (!ENABLE_INVITATION_CODES) {
        throw new Error('邀请码功能未启用');
    }

    const code = generateInvitationCode();
    const now = Date.now();
    const durationDays = getDurationDays(durationType);

    const invitation = {
        code,
        createdBy,
        createdAt: now,
        used: false,
        usedBy: null,
        usedAt: null,
        durationType: durationType || 'permanent',
        durationDays,
        userExpiresAt: null,  // 使用后会设置为用户的到期时间
    };

    await storage.setItem(toInvitationKey(code), invitation);
    console.log(`Invitation code created: ${code} by ${createdBy}, duration: ${durationType}`);

    return invitation;
}

/**
 * 验证邀请码
 * @param {string} code 邀请码
 * @returns {Promise<{valid: boolean, reason?: string, invitation?: InvitationCode}>} 验证结果
 */
export async function validateInvitationCode(code) {
    if (!ENABLE_INVITATION_CODES) {
        return { valid: true }; // 如果功能未启用，则认为有效
    }

    if (!code || typeof code !== 'string') {
        return { valid: false, reason: '邀请码格式无效' };
    }

    const invitation = await storage.getItem(toInvitationKey(code.toUpperCase()));

    if (!invitation) {
        return { valid: false, reason: '邀请码不存在' };
    }

    if (invitation.used) {
        return { valid: false, reason: '邀请码已被使用' };
    }

    // 邀请码永不过期

    return { valid: true, invitation };
}

/**
 * 使用邀请码
 * @param {string} code 邀请码
 * @param {string} usedBy 使用者用户句柄
 * @param {number | null} userExpiresAt 用户到期时间
 * @returns {Promise<{success: boolean, invitation?: InvitationCode}>} 使用结果及邀请码信息
 */
export async function useInvitationCode(code, usedBy, userExpiresAt = null) {
    if (!ENABLE_INVITATION_CODES) {
        return { success: true }; // 如果功能未启用，则认为成功
    }

    const validation = await validateInvitationCode(code);
    if (!validation.valid) {
        return { success: false };
    }

    const invitation = validation.invitation;
    if (!invitation) {
        return { success: false };
    }
    invitation.used = true;
    invitation.usedBy = usedBy;
    invitation.usedAt = Date.now();
    invitation.userExpiresAt = userExpiresAt; // 记录用户的到期时间

    await storage.setItem(toInvitationKey(code.toUpperCase()), invitation);
    console.log(`Invitation code used: ${code} by ${usedBy}, duration: ${invitation.durationType}, user expires: ${userExpiresAt ? new Date(userExpiresAt).toLocaleString() : 'permanent'}`);

    return { success: true, invitation };
}

/**
 * 获取所有邀请码
 * @returns {Promise<InvitationCode[]>} 邀请码列表
 */
export async function getAllInvitationCodes() {
    if (!ENABLE_INVITATION_CODES) {
        return [];
    }

    const keys = await storage.keys();
    const invitationKeys = keys.filter(key => key.startsWith(INVITATION_PREFIX) && key !== PURCHASE_LINK_KEY);

    const invitations = [];
    for (const key of invitationKeys) {
        const invitation = await storage.getItem(key);
        // 过滤掉无效的邀请码（code为undefined、null或空字符串）
        if (invitation && invitation.code && typeof invitation.code === 'string') {
            invitations.push(invitation);
        } else if (invitation) {
            // 删除无效的邀请码
            await storage.removeItem(key);
        }
    }

    // 按创建时间降序排序
    return invitations.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 删除邀请码
 * @param {string} code 邀请码
 * @returns {Promise<boolean>} 是否成功删除
 */
export async function deleteInvitationCode(code) {
    if (!ENABLE_INVITATION_CODES) {
        return false;
    }

    const key = toInvitationKey(code.toUpperCase());
    const invitation = await storage.getItem(key);

    if (!invitation) {
        return false;
    }

    await storage.removeItem(key);
    console.log(`Invitation code deleted: ${code}`);

    return true;
}

/**
 * 检查是否启用邀请码功能
 * @returns {boolean} 是否启用
 */
export function isInvitationCodesEnabled() {
    return ENABLE_INVITATION_CODES;
}

/**
 * 清理已使用的邀请码（可选功能）
 * @returns {Promise<number>} 清理的数量
 */
export async function cleanupExpiredInvitationCodes() {
    if (!ENABLE_INVITATION_CODES) {
        return 0;
    }

    let cleanedCount = 0;

    // 只清理已使用的邀请码（可选）
    // 注释掉此功能，因为已使用的邀请码可能需要保留用于记录
    /*
    const invitations = await getAllInvitationCodes();
    for (const invitation of invitations) {
        if (invitation.used) {
            await deleteInvitationCode(invitation.code);
            cleanedCount++;
        }
    }
    */

    if (cleanedCount > 0) {
        console.log(`Cleaned up ${cleanedCount} used invitation codes`);
    }

    return cleanedCount;
}

/**
 * 设置购买链接
 * @param {string} purchaseLink 购买链接URL
 * @returns {Promise<void>}
 */
export async function setPurchaseLink(purchaseLink) {
    await storage.setItem(PURCHASE_LINK_KEY, purchaseLink || '');
    console.log('Purchase link updated:', purchaseLink || '(cleared)');
}

/**
 * 获取购买链接
 * @returns {Promise<string>} 购买链接URL
 */
export async function getPurchaseLink() {
    const link = await storage.getItem(PURCHASE_LINK_KEY);
    return link || '';
}
