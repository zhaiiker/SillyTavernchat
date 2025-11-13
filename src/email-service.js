import nodemailer from 'nodemailer';
import { getConfigValue } from './util.js';

/**
 * 邮件服务配置缓存
 */
let emailConfig = null;
let transporter = null;

/**
 * 从配置文件加载邮件配置
 * @returns {Object|null} 邮件配置对象
 */
function loadEmailConfig() {
    try {
        const config = {
            enabled: getConfigValue('email.enabled', false, 'boolean'),
            host: getConfigValue('email.smtp.host', ''),
            port: getConfigValue('email.smtp.port', 587, 'number'),
            secure: getConfigValue('email.smtp.secure', false, 'boolean'),
            user: getConfigValue('email.smtp.user', ''),
            password: getConfigValue('email.smtp.password', ''),
            from: getConfigValue('email.from', ''),
            fromName: getConfigValue('email.fromName', 'SillyTavern'),
        };

        // 验证必需的配置项
        if (config.enabled && (!config.host || !config.user || !config.password || !config.from)) {
            console.warn('邮件服务已启用但配置不完整，请检查 config.yaml 中的 email 配置');
            return null;
        }

        return config;
    } catch (error) {
        console.error('加载邮件配置失败:', error);
        return null;
    }
}

/**
 * 初始化邮件传输器
 * @returns {Object|null} nodemailer 传输器对象
 */
function initTransporter() {
    emailConfig = loadEmailConfig();

    if (!emailConfig || !emailConfig.enabled) {
        return null;
    }

    try {
        // 端口465默认使用SSL，其他端口使用STARTTLS
        const useSSL = emailConfig.port === 465 ? true : emailConfig.secure;

        const transportConfig = {
            host: emailConfig.host,
            port: emailConfig.port,
            secure: useSSL,
            auth: {
                user: emailConfig.user,
                pass: emailConfig.password,
            },
        };

        // 如果不使用SSL但端口是587，添加TLS配置
        if (!useSSL && emailConfig.port === 587) {
            transportConfig.requireTLS = true;
            transportConfig.tls = {
                ciphers: 'SSLv3',
                rejectUnauthorized: false,
            };
        }

        // 添加调试日志
        console.log('邮件服务配置:', {
            host: transportConfig.host,
            port: transportConfig.port,
            secure: transportConfig.secure,
            user: transportConfig.auth.user,
        });

        transporter = nodemailer.createTransport(transportConfig);

        console.log('邮件服务已初始化');
        return transporter;
    } catch (error) {
        console.error('初始化邮件传输器失败:', error);
        return null;
    }
}

/**
 * 检查邮件服务是否可用
 * @returns {boolean} 是否可用
 */
export function isEmailServiceAvailable() {
    if (!transporter) {
        initTransporter();
    }
    return transporter !== null && emailConfig?.enabled === true;
}

/**
 * 获取邮件配置（包含密码，仅供管理员使用）
 * @returns {Object} 邮件配置
 */
export function getEmailConfig() {
    if (!emailConfig) {
        emailConfig = loadEmailConfig();
    }

    if (!emailConfig) {
        return { enabled: false };
    }

    return {
        enabled: emailConfig.enabled,
        host: emailConfig.host,
        port: emailConfig.port,
        secure: emailConfig.secure,
        user: emailConfig.user,
        password: emailConfig.password,  // 包含密码，因为只有管理员能访问
        from: emailConfig.from,
        fromName: emailConfig.fromName,
    };
}

/**
 * 重新加载邮件配置
 */
export function reloadEmailConfig() {
    transporter = null;
    emailConfig = null;
    initTransporter();
}

/**
 * 发送邮件
 * @param {string} to 收件人邮箱
 * @param {string} subject 邮件主题
 * @param {string} text 纯文本内容
 * @param {string|null} [html] HTML内容（可选）
 * @returns {Promise<boolean>} 是否发送成功
 */
export async function sendEmail(to, subject, text, html = null) {
    if (!isEmailServiceAvailable()) {
        console.error('邮件服务未启用或配置不完整');
        return false;
    }

    try {
        const mailOptions = {
            from: `"${emailConfig.fromName}" <${emailConfig.from}>`,
            to: to,
            subject: subject,
            text: text,
        };

        if (html) {
            mailOptions.html = html;
        }

        const info = await transporter.sendMail(mailOptions);
        console.log('邮件发送成功:', info.messageId, 'to', to);
        return true;
    } catch (error) {
        console.error('发送邮件失败:', error);
        return false;
    }
}

/**
 * 发送验证码邮件
 * @param {string} to 收件人邮箱
 * @param {string} code 验证码
 * @param {string} userName 用户名
 * @returns {Promise<boolean>} 是否发送成功
 */
export async function sendVerificationCode(to, code, userName) {
    const subject = 'SillyTavern - 注册验证码';
    const text = `
尊敬的 ${userName}，

感谢您注册 SillyTavern！

您的验证码是：${code}

此验证码将在 5 分钟内有效。请不要将此验证码告诉任何人。

如果这不是您本人的操作，请忽略此邮件。

祝好，
SillyTavern 团队
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background-color: #4a90e2;
            color: white;
            padding: 20px;
            text-align: center;
            border-radius: 5px 5px 0 0;
        }
        .content {
            background-color: #f9f9f9;
            padding: 30px;
            border: 1px solid #ddd;
            border-top: none;
        }
        .code {
            background-color: #fff;
            border: 2px dashed #4a90e2;
            padding: 20px;
            text-align: center;
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 5px;
            margin: 20px 0;
            color: #4a90e2;
        }
        .footer {
            background-color: #f0f0f0;
            padding: 15px;
            text-align: center;
            font-size: 12px;
            color: #666;
            border-radius: 0 0 5px 5px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>SillyTavern 注册验证</h1>
    </div>
    <div class="content">
        <p>尊敬的 <strong>${userName}</strong>，</p>
        <p>感谢您注册 SillyTavern！</p>
        <p>您的验证码是：</p>
        <div class="code">${code}</div>
        <p>此验证码将在 <strong>5 分钟</strong>内有效。请不要将此验证码告诉任何人。</p>
        <p>如果这不是您本人的操作，请忽略此邮件。</p>
    </div>
    <div class="footer">
        <p>此邮件由 SillyTavern 系统自动发送，请勿回复。</p>
    </div>
</body>
</html>
    `.trim();

    return await sendEmail(to, subject, text, html);
}

/**
 * 发送密码恢复码邮件
 * @param {string} to 收件人邮箱
 * @param {string} code 恢复码
 * @param {string} userName 用户名
 * @returns {Promise<boolean>} 是否发送成功
 */
export async function sendPasswordRecoveryCode(to, code, userName) {
    const subject = 'SillyTavern - 密码找回';
    const text = `
尊敬的 ${userName}，

我们收到了您的密码找回请求。

您的密码恢复码是：${code}

此恢复码将在 5 分钟内有效。请使用此恢复码重置您的密码。

如果这不是您本人的操作，请立即联系管理员，您的账户可能存在安全风险。

祝好，
SillyTavern 团队
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background-color: #e74c3c;
            color: white;
            padding: 20px;
            text-align: center;
            border-radius: 5px 5px 0 0;
        }
        .content {
            background-color: #f9f9f9;
            padding: 30px;
            border: 1px solid #ddd;
            border-top: none;
        }
        .code {
            background-color: #fff;
            border: 2px dashed #e74c3c;
            padding: 20px;
            text-align: center;
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 5px;
            margin: 20px 0;
            color: #e74c3c;
        }
        .warning {
            background-color: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 15px 0;
        }
        .footer {
            background-color: #f0f0f0;
            padding: 15px;
            text-align: center;
            font-size: 12px;
            color: #666;
            border-radius: 0 0 5px 5px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>密码找回请求</h1>
    </div>
    <div class="content">
        <p>尊敬的 <strong>${userName}</strong>，</p>
        <p>我们收到了您的密码找回请求。</p>
        <p>您的密码恢复码是：</p>
        <div class="code">${code}</div>
        <p>此恢复码将在 <strong>5 分钟</strong>内有效。请使用此恢复码重置您的密码。</p>
        <div class="warning">
            <strong>⚠️ 安全提醒：</strong>
            <p>如果这不是您本人的操作，请立即联系管理员，您的账户可能存在安全风险。</p>
        </div>
    </div>
    <div class="footer">
        <p>此邮件由 SillyTavern 系统自动发送，请勿回复。</p>
    </div>
</body>
</html>
    `.trim();

    return await sendEmail(to, subject, text, html);
}

/**
 * 测试邮件配置
 * @param {string} testEmail 测试邮箱地址
 * @returns {Promise<{success: boolean, error?: string}>} 测试结果
 */
export async function testEmailConfig(testEmail) {
    if (!isEmailServiceAvailable()) {
        return {
            success: false,
            error: '邮件服务未启用或配置不完整',
        };
    }

    try {
        console.log('开始验证SMTP连接...');
        await transporter.verify();
        console.log('SMTP连接验证成功');

        const subject = 'SillyTavern - 邮件配置测试';
        const text = '这是一封测试邮件。如果您收到此邮件，说明邮件服务配置正确。';
        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: Arial, sans-serif;
            padding: 20px;
            max-width: 600px;
            margin: 0 auto;
        }
        .success {
            background-color: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
            padding: 20px;
            border-radius: 5px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="success">
        <h2>✓ 邮件配置测试成功</h2>
        <p>这是一封测试邮件。如果您收到此邮件，说明邮件服务配置正确。</p>
        <p>发送时间：${new Date().toLocaleString('zh-CN')}</p>
    </div>
</body>
</html>
        `.trim();

        console.log('开始发送测试邮件到:', testEmail);
        const success = await sendEmail(testEmail, subject, text, html);

        if (success) {
            return { success: true };
        } else {
            return {
                success: false,
                error: '邮件发送失败，请检查服务器日志',
            };
        }
    } catch (error) {
        console.error('邮件配置测试失败:', error);
        return {
            success: false,
            error: error.message || '未知错误',
        };
    }
}

