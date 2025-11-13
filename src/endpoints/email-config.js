import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import express from 'express';
import { getEmailConfig, testEmailConfig, reloadEmailConfig } from '../email-service.js';
import { requireAdminMiddleware } from '../users.js';

export const router = express.Router();

/**
 * 获取邮件配置
 */
router.get('/get', requireAdminMiddleware, async (request, response) => {
    try {
        const config = getEmailConfig();
        return response.json(config);
    } catch (error) {
        console.error('Get email config failed:', error);
        return response.status(500).json({ error: '获取邮件配置失败' });
    }
});

/**
 * 保存邮件配置到 config.yaml
 */
router.post('/save', requireAdminMiddleware, async (request, response) => {
    try {
        const { enabled, host, port, secure, user, password, from, fromName } = request.body;

        // 读取现有的 config.yaml
        const configPath = path.join(process.cwd(), 'config.yaml');
        let config = {};

        if (fs.existsSync(configPath)) {
            const configContent = fs.readFileSync(configPath, 'utf8');
            config = yaml.parse(configContent);
        }

        // 更新邮件配置
        config.email = {
            enabled: enabled || false,
            smtp: {
                host: host || '',
                port: parseInt(port) || 587,
                secure: secure || false,
                user: user || '',
                password: password || '',
            },
            from: from || '',
            fromName: fromName || 'SillyTavern',
        };

        // 写回 config.yaml
        const newConfigContent = yaml.stringify(config);
        fs.writeFileSync(configPath, newConfigContent, 'utf8');

        // 重新加载邮件配置
        reloadEmailConfig();

        console.info('Email config saved successfully');
        return response.json({ success: true, message: '邮件配置已保存。部分更改可能需要重启服务器才能生效。' });
    } catch (error) {
        console.error('Save email config failed:', error);
        return response.status(500).json({ error: '保存邮件配置失败: ' + error.message });
    }
});

/**
 * 测试邮件配置
 */
router.post('/test', requireAdminMiddleware, async (request, response) => {
    try {
        const { testEmail } = request.body;

        if (!testEmail) {
            return response.status(400).json({ error: '请提供测试邮箱地址' });
        }

        // 验证邮箱格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(testEmail)) {
            return response.status(400).json({ error: '邮箱格式不正确' });
        }

        const result = await testEmailConfig(testEmail);

        if (result.success) {
            console.info('Email test successful for', testEmail);
            return response.json({ success: true, message: '测试邮件已发送，请检查您的邮箱' });
        } else {
            console.error('Email test failed:', result.error);
            return response.status(500).json({ error: '测试失败: ' + result.error });
        }
    } catch (error) {
        console.error('Test email config failed:', error);
        return response.status(500).json({ error: '测试邮件配置失败: ' + error.message });
    }
});

