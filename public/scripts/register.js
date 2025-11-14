// 注册页面JavaScript
let regCsrfToken = '';

async function getCsrfToken() {
    try {
        const res = await fetch('/csrf-token', { method: 'GET', credentials: 'same-origin' });
        const data = await res.json();
        regCsrfToken = data.token || '';
    } catch (_) {
        // ignore; server may have CSRF disabled
        regCsrfToken = '';
    }
}

document.addEventListener('DOMContentLoaded', async function() {
    const registerForm = /** @type {HTMLFormElement} */ (document.getElementById('registerForm'));
    const errorMessage = /** @type {HTMLElement} */ (document.getElementById('errorMessage'));
    const registerButton = /** @type {HTMLButtonElement} */ (document.getElementById('registerButton'));
    const backToLoginButton = /** @type {HTMLButtonElement} */ (document.getElementById('backToLoginButton'));
    const invitationSection = /** @type {HTMLElement} */ (document.getElementById('invitationSection'));
    const invitationCodeGroup = /** @type {HTMLElement} */ (document.getElementById('invitationCodeGroup'));

    const userHandleInput = /** @type {HTMLInputElement} */ (document.getElementById('userHandle'));
    const displayNameInput = /** @type {HTMLInputElement} */ (document.getElementById('displayName'));
    const userPasswordInput = /** @type {HTMLInputElement} */ (document.getElementById('userPassword'));
    const confirmPasswordInput = /** @type {HTMLInputElement} */ (document.getElementById('confirmPassword'));
    const userEmailInput = /** @type {HTMLInputElement} */ (document.getElementById('userEmail'));
    const verificationCodeInput = /** @type {HTMLInputElement} */ (document.getElementById('verificationCode'));
    const sendVerificationButton = /** @type {HTMLButtonElement} */ (document.getElementById('sendVerificationButton'));
    const invitationCodeInput = /** @type {HTMLInputElement} */ (document.getElementById('invitationCode'));

    let verificationCodeSent = false;
    let verificationCooldown = 0;
    let emailServiceEnabled = false;

    // 先获取CSRF Token，再检查是否需要邀请码和邮件服务状态
    await getCsrfToken();
    await checkEmailServiceStatus();
    await checkInvitationCodeStatus();

    // 返回登录按钮事件
    backToLoginButton.addEventListener('click', function() {
        window.location.href = '/login';
    });

    // 发送验证码按钮事件
    sendVerificationButton.addEventListener('click', async function() {
        const email = userEmailInput.value.trim();
        const userName = displayNameInput.value.trim() || userHandleInput.value.trim();

        if (!email) {
            showError('请输入邮箱地址');
            return;
        }

        if (!userName) {
            showError('请先填写显示名称或用户名');
            return;
        }

        // 验证邮箱格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            showError('邮箱格式不正确');
            return;
        }

        // 发送验证码
        await sendVerificationCodeToEmail(email, userName);
    });

    // 表单提交事件
    registerForm.addEventListener('submit', function(e) {
        e.preventDefault();

        const formData = {
            handle: userHandleInput.value.trim(),
            name: displayNameInput.value.trim(),
            password: userPasswordInput.value,
            confirmPassword: confirmPasswordInput.value,
            email: userEmailInput.value.trim(),
            verificationCode: verificationCodeInput.value.trim(),
            invitationCode: invitationCodeInput.value.trim()
        };

        // 基本验证
        if (!validateForm(formData)) {
            return;
        }

        // 提交注册请求
        submitRegistration(formData);
    });

    // 实时验证
    userHandleInput.addEventListener('input', validateHandle);
    userPasswordInput.addEventListener('input', validatePassword);
    confirmPasswordInput.addEventListener('input', validateConfirmPassword);

    async function checkEmailServiceStatus() {
        try {
            const response = await fetch('/api/email/status', {
                method: 'GET',
                credentials: 'same-origin',
            });
            if (!response.ok) {
                emailServiceEnabled = false;
                return;
            }
            const data = await response.json();
            emailServiceEnabled = data.enabled || false;

            // 如果邮件服务未启用，隐藏整个邮箱验证区域
            const emailSection = document.getElementById('emailSection');

            if (!emailServiceEnabled) {
                if (emailSection) emailSection.style.display = 'none';
                userEmailInput.required = false;
                verificationCodeInput.required = false;
            } else {
                if (emailSection) emailSection.style.display = 'block';
                userEmailInput.required = true;
                verificationCodeInput.required = true;
            }
        } catch (error) {
            console.error('Error checking email service status:', error);
            emailServiceEnabled = false;
            // 出错时隐藏整个邮箱验证区域
            const emailSection = document.getElementById('emailSection');
            if (emailSection) emailSection.style.display = 'none';
            userEmailInput.required = false;
            verificationCodeInput.required = false;
        }
    }

    async function checkInvitationCodeStatus() {
        try {
            const response = await fetch('/api/invitation-codes/status', {
                method: 'GET',
                headers: regCsrfToken ? { 'x-csrf-token': regCsrfToken } : {},
                credentials: 'same-origin',
            });
            if (!response.ok) {
                // 可能是被中间件拦截，直接退出不影响注册
                return;
            }
            const data = await response.json();
            if (data && data.enabled) {
                if (invitationSection) invitationSection.style.display = 'block';
                invitationCodeInput.required = true;
            }
        } catch (error) {
            console.error('Error checking invitation code status:', error);
        }
    }

    function validateForm(formData) {
        // 清除之前的错误消息
        hideError();

        // 检查基本必填字段
        if (!formData.handle || !formData.name || !formData.password || !formData.confirmPassword) {
            showError('请填写所有必填字段');
            return false;
        }

        // 如果邮件服务启用，验证邮箱和验证码
        if (emailServiceEnabled) {
            if (!formData.email || !formData.verificationCode) {
                showError('请填写邮箱和验证码');
                return false;
            }

            // 验证邮箱格式
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(formData.email)) {
                showError('邮箱格式不正确');
                return false;
            }

            // 验证验证码格式
            if (!/^\d{6}$/.test(formData.verificationCode)) {
                showError('验证码格式不正确，应为6位数字');
                return false;
            }
        }

        // 规范化用户名：支持英文大小写、数字和横杠
        const normalizedHandle = normalizeHandleFrontend(formData.handle);

        if (!normalizedHandle) {
            showError('用户名无效，仅支持英文、数字和横杠');
            return false;
        }

        // 验证用户名格式：只允许字母、数字和横杠
        if (!/^[a-z0-9-]+$/.test(normalizedHandle)) {
            showError('用户名只能包含字母、数字和横杠');
            return false;
        }

        // 额外：限制过于随意/弱的用户名
        if (isTrivialHandle(normalizedHandle)) {
            showError('用户名过于简单或在黑名单中，请使用更有辨识度的用户名');
            return false;
        }

        // 验证密码长度
        if (formData.password.length < 6) {
            showError('密码长度至少6位');
            return false;
        }

        // 验证密码确认
        if (formData.password !== formData.confirmPassword) {
            showError('两次输入的密码不一致');
            return false;
        }

        // 如果需要邀请码，检查是否填写
        const needsInvitation = invitationSection && invitationSection.style.display !== 'none';
        if (needsInvitation && !formData.invitationCode) {
            showError('请输入邀请码');
            return false;
        }

        return true;
    }

    function validateHandle() {
        const handle = this.value.trim();
        const input = this;

        if (!handle) {
            input.classList.remove('valid', 'invalid');
            return;
        }

        // 规范化用户名：支持英文大小写、数字和横杠
        const normalizedHandle = normalizeHandleFrontend(handle);

        if (!normalizedHandle || !/^[a-z0-9-]+$/.test(normalizedHandle) || isTrivialHandle(normalizedHandle)) {
            input.classList.remove('valid');
            input.classList.add('invalid');
        } else {
            input.classList.remove('invalid');
            input.classList.add('valid');
        }
    }

    /**
     * 前端用户名规范化函数（与后端保持一致）
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

    // 与后端一致的随意/弱用户名判断
    function isTrivialHandle(handle) {
        if (!handle) return true;
        const h = String(handle).toLowerCase().replace(/-/g, ''); // 移除横杠后判断

        // 长度太短
        if (h.length < 3) return true;

        if (/^\d{3,}$/.test(h)) return true; // 纯数字且>=3
        if (/^(.)\1{2,}$/.test(h)) return true; // 同字符重复>=3
        const banned = new Set([
            '123', '1234', '12345', '123456', '000', '0000', '111', '1111',
            'qwe', 'qwer', 'qwert', 'qwerty', 'asdf', 'zxc', 'zxcv', 'zxcvb', 'qaz', 'qazwsx',
            'test', 'tester', 'testing', 'guest', 'user', 'username', 'admin', 'root', 'null', 'void',
            'abc', 'abcd', 'abcdef'
        ]);
        return banned.has(h);
    }

    function validatePassword() {
        const password = this.value;
        const input = this;

        if (!password) {
            input.classList.remove('valid', 'invalid');
            return;
        }

        if (password.length < 6) {
            input.classList.remove('valid');
            input.classList.add('invalid');
        } else {
            input.classList.remove('invalid');
            input.classList.add('valid');
        }

        // 同时验证确认密码
        const confirmPassword = confirmPasswordInput;
        if (confirmPassword.value) {
            validateConfirmPassword.call(confirmPassword);
        }
    }

    function validateConfirmPassword() {
        const password = userPasswordInput.value;
        const confirmPassword = this.value;
        const input = this;

        if (!confirmPassword) {
            input.classList.remove('valid', 'invalid');
            return;
        }

        if (password !== confirmPassword) {
            input.classList.remove('valid');
            input.classList.add('invalid');
        } else {
            input.classList.remove('invalid');
            input.classList.add('valid');
        }
    }

    function submitRegistration(formData) {
        // 显示加载状态
        setLoading(true);

        fetch('/api/users/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(regCsrfToken ? { 'x-csrf-token': regCsrfToken } : {}),
            },
            body: JSON.stringify(formData)
        })
        .then(async (response) => {
            // 先读取响应文本（只读取一次）
            const text = await response.text();

            if (!response.ok) {
                // 尝试解析为 JSON 获取错误信息
                try {
                    const data = JSON.parse(text);
                    throw new Error(data.error || '注册失败');
                } catch (e) {
                    // 如果不是 JSON，直接使用文本内容
                    throw new Error(text || '注册失败');
                }
            }

            // 成功时也解析文本为 JSON
            try {
                return JSON.parse(text);
            } catch {
                return {};
            }
        })
        .then(data => {
            // 注册成功，显示消息并跳转到登录页面
            const message = data.message || '注册成功！正在跳转到登录页面...';
            showSuccess(message);

            // 如果用户名被规范化，额外提示
            if (data.message && data.message.includes('规范化')) {
                console.info('用户名已规范化为:', data.handle);
            }

            setTimeout(() => {
                window.location.href = '/login';
            }, 3000); // 延长到3秒，让用户看清提示
        })
        .catch(error => {
            console.error('Registration error:', error);
            showError(error.message || '注册失败，请稍后重试');
        })
        .finally(() => {
            setLoading(false);
        });
    }

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.add('show');
        errorMessage.style.background = 'rgba(220, 53, 69, 0.1)';
        errorMessage.style.borderColor = 'rgba(220, 53, 69, 0.3)';
        errorMessage.style.color = '#721c24';
    }

    function showSuccess(message) {
        errorMessage.textContent = message;
        errorMessage.classList.add('show');
        errorMessage.style.background = 'rgba(40, 167, 69, 0.1)';
        errorMessage.style.borderColor = 'rgba(40, 167, 69, 0.3)';
        errorMessage.style.color = '#155724';
    }

    function hideError() {
        errorMessage.classList.remove('show');
    }

    function setLoading(loading) {
        if (loading) {
            registerButton.classList.add('loading');
            registerButton.disabled = true;
            registerButton.textContent = '注册中...';
        } else {
            registerButton.classList.remove('loading');
            registerButton.disabled = false;
            registerButton.textContent = '创建账户';
        }
    }

    async function sendVerificationCodeToEmail(email, userName) {
        if (verificationCooldown > 0) {
            showError(`请等待 ${verificationCooldown} 秒后再次发送`);
            return;
        }

        // 禁用按钮并显示加载状态
        sendVerificationButton.disabled = true;
        sendVerificationButton.textContent = '发送中...';

        try {
            const response = await fetch('/api/users/send-verification', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(regCsrfToken ? { 'x-csrf-token': regCsrfToken } : {}),
                },
                body: JSON.stringify({ email, userName })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '发送验证码失败');
            }

            verificationCodeSent = true;
            showSuccess('验证码已发送至您的邮箱，请查收');

            // 启动60秒冷却
            verificationCooldown = 60;
            updateCooldownButton();

            const interval = setInterval(() => {
                verificationCooldown--;
                if (verificationCooldown <= 0) {
                    clearInterval(interval);
                    sendVerificationButton.disabled = false;
                    sendVerificationButton.textContent = '重新发送';
                } else {
                    updateCooldownButton();
                }
            }, 1000);

        } catch (error) {
            console.error('Send verification code error:', error);
            showError(error.message || '发送验证码失败，请稍后重试');
            sendVerificationButton.disabled = false;
            sendVerificationButton.textContent = '发送验证码';
        }
    }

    function updateCooldownButton() {
        sendVerificationButton.textContent = `${verificationCooldown}秒后重试`;
    }
});
