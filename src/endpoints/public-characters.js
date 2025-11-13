import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { humanizedISO8601DateTime } from '../util.js';

// 公用角色卡存储目录
const PUBLIC_CHARACTERS_DIR = path.join(globalThis.DATA_ROOT, 'public_characters');
// 角色卡评论存储目录
const CHARACTER_COMMENTS_DIR = path.join(globalThis.DATA_ROOT, 'forum_data', 'character_comments');

// 确保目录存在
if (!fs.existsSync(PUBLIC_CHARACTERS_DIR)) {
    fs.mkdirSync(PUBLIC_CHARACTERS_DIR, { recursive: true });
}
if (!fs.existsSync(CHARACTER_COMMENTS_DIR)) {
    fs.mkdirSync(CHARACTER_COMMENTS_DIR, { recursive: true });
}

export const router = express.Router();

/**
 * 生成角色卡ID
 * @returns {string} 角色卡ID
 */
function generateCharacterId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * 保存公用角色卡数据
 * @param {object} character 角色卡数据
 * @returns {boolean} 是否成功
 */
function savePublicCharacter(character) {
    try {
        const characterPath = path.join(PUBLIC_CHARACTERS_DIR, `${character.id}.json`);
        writeFileAtomicSync(characterPath, JSON.stringify(character, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving public character:', error);
        return false;
    }
}

/**
 * 获取所有公用角色卡
 * @returns {Array} 角色卡列表
 */
function getAllPublicCharacters() {
    try {
        const files = fs.readdirSync(PUBLIC_CHARACTERS_DIR);
        const characters = [];

        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const characterPath = path.join(PUBLIC_CHARACTERS_DIR, file);
                    const characterData = fs.readFileSync(characterPath, 'utf8');
                    const character = JSON.parse(characterData);
                    characters.push(character);
                } catch (error) {
                    console.error(`Error reading character file ${file}:`, error);
                }
            }
        }

        // 按上传时间倒序排列
        return characters.sort((a, b) => new Date(b.uploaded_at || 0).getTime() - new Date(a.uploaded_at || 0).getTime());
    } catch (error) {
        console.error('Error getting all public characters:', error);
        return [];
    }
}

/**
 * 获取角色卡详情
 * @param {string} characterId 角色卡ID
 * @returns {object|null} 角色卡数据
 */
function getPublicCharacter(characterId) {
    try {
        const characterPath = path.join(PUBLIC_CHARACTERS_DIR, `${characterId}.json`);
        if (!fs.existsSync(characterPath)) {
            return null;
        }

        const characterData = fs.readFileSync(characterPath, 'utf8');
        return JSON.parse(characterData);
    } catch (error) {
        console.error('Error getting public character:', error);
        return null;
    }
}

// 获取所有公用角色卡
router.get('/', async function (request, response) {
    try {
        const characters = getAllPublicCharacters();
        response.json(characters);
    } catch (error) {
        console.error('Error getting public characters:', error);
        response.status(500).json({ error: 'Failed to get public characters' });
    }
});

// 获取角色卡详情
router.get('/:characterId', async function (request, response) {
    try {
        const { characterId } = request.params;
        const character = getPublicCharacter(characterId);

        if (!character) {
            return response.status(404).json({ error: 'Character not found' });
        }

        response.json(character);
    } catch (error) {
        console.error('Error getting public character:', error);
        response.status(500).json({ error: 'Failed to get character' });
    }
});

// 文件类型验证中间件
function validateFileType(req, res, next) {
    const file = req.file;

    if (!file) {
        return res.status(400).json({ error: '请选择角色卡文件' });
    }

    // 只允许图片和JSON/YAML文件
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'application/json', 'text/yaml', 'text/x-yaml'];
    const isValidType = allowedTypes.includes(file.mimetype) ||
                       file.originalname.endsWith('.json') ||
                       file.originalname.endsWith('.yaml') ||
                       file.originalname.endsWith('.yml');

    if (!isValidType) {
        return res.status(400).json({ error: '不支持的文件类型' });
    }

    // 检查文件大小 (10MB)
    if (file.size > 10 * 1024 * 1024) {
        return res.status(400).json({ error: '文件大小不能超过10MB' });
    }

    next();
}

// 上传公用角色卡 - 移除局部 multer 配置，使用全局配置
router.post('/upload', validateFileType, async function (request, response) {
    try {
        if (!request.user) {
            return response.status(401).json({ error: 'Authentication required' });
        }

        const { name, description, tags, file_type } = request.body;
        const file = request.file;

        // 规范化并推断文件类型
        let fileType = (file_type || '').toString().trim().toLowerCase();
        if (!fileType) {
            const byMime = (file?.mimetype || '').toLowerCase();
            if (byMime.includes('png')) fileType = 'png';
            else if (byMime.includes('json')) fileType = 'json';
            else if (byMime.includes('yaml') || byMime.includes('yml')) fileType = 'yaml';
        }
        if (!fileType) {
            const original = file?.originalname || '';
            const ext = original.split('.').pop()?.toLowerCase();
            if (ext === 'png') fileType = 'png';
            else if (ext === 'json') fileType = 'json';
            else if (ext === 'yaml' || ext === 'yml') fileType = 'yaml';
        }

        if (!file) {
            return response.status(400).json({ error: '请选择角色卡文件' });
        }

        if (!name) {
            // 清理上传的文件
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
            return response.status(400).json({ error: '请输入角色名称' });
        }

        // 解析角色卡数据
        let characterData = {};
        let avatarPath = null;

        try {
            if (fileType === 'json') {
                // JSON文件
                const fileContent = fs.readFileSync(file.path, 'utf8');
                characterData = JSON.parse(fileContent);
            } else if (fileType === 'yaml' || fileType === 'yml') {
                // YAML文件
                const yamlModule = await import('js-yaml');
                const yaml = yamlModule.default || yamlModule;
                const fileContent = fs.readFileSync(file.path, 'utf8');
                characterData = yaml.load(fileContent) || {};
            } else if (fileType === 'png') {
                // PNG文件 - 从tEXt块中提取角色数据
                const characterCardParser = await import('../character-card-parser.js');
                const parse = characterCardParser.parse;
                const parsedData = await parse(file.path, 'png');
                try {
                    characterData = JSON.parse(parsedData);
                } catch (e) {
                    // 如果不是合法JSON，抛出格式错误
                    throw new Error('PNG内嵌角色数据不是有效的JSON');
                }
            }

            // 移动文件到公共角色卡目录
            const characterId = generateCharacterId();
            const fileName = `${characterId}.${fileType}`;
            const finalPath = path.join(PUBLIC_CHARACTERS_DIR, fileName);

            fs.renameSync(file.path, finalPath);
            avatarPath = fileName;

        } catch (parseError) {
            // 清理临时文件
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
            console.error('Error parsing character file:', parseError);
            return response.status(400).json({ error: '角色卡文件格式错误' });
        }

        // 解析标签
        let parsedTags = [];
        if (tags) {
            try {
                parsedTags = JSON.parse(tags);
            } catch (e) {
                parsedTags = tags.split(',').map(tag => tag.trim()).filter(tag => tag);
            }
        }

        const character = {
            id: generateCharacterId(),
            name: name.trim(),
            description: description?.trim() || '',
            tags: parsedTags,
            uploader: {
                handle: request.user.profile.handle,
                name: request.user.profile.name,
            },
            uploaded_at: humanizedISO8601DateTime(),
            created_at: humanizedISO8601DateTime(),
            character_data: characterData,
            avatar: avatarPath,
            downloads: 0,
        };

        if (savePublicCharacter(character)) {
            console.info(`Public character "${character.name}" uploaded by ${character.uploader.handle}`);
            response.json(character);
        } else {
            response.status(500).json({ error: 'Failed to save character' });
        }
    } catch (error) {
        console.error('Error uploading public character:', error);
        response.status(500).json({ error: 'Failed to upload character' });
    }
});

// 删除公用角色卡
router.delete('/:characterId', async function (request, response) {
    try {
        const { characterId } = request.params;

        if (!request.user) {
            return response.status(401).json({ error: 'Authentication required' });
        }

        const character = getPublicCharacter(characterId);
        if (!character) {
            return response.status(404).json({ error: 'Character not found' });
        }

        // 检查权限：只有上传者或管理员可以删除
        const isUploader = character.uploader.handle === request.user.profile.handle;
        const isAdmin = request.user.profile.admin;

        if (!isUploader && !isAdmin) {
            return response.status(403).json({ error: 'Permission denied' });
        }

        // 删除角色卡文件
        const characterPath = path.join(PUBLIC_CHARACTERS_DIR, `${characterId}.json`);
        fs.unlinkSync(characterPath);

        console.info(`Public character "${character.name}" deleted by ${request.user.profile.handle}`);
        response.json({ success: true });
    } catch (error) {
        console.error('Error deleting public character:', error);
        response.status(500).json({ error: 'Failed to delete character' });
    }
});

// 搜索公用角色卡
router.get('/search', async function (request, response) {
    try {
        const { q, uploader } = request.query;
        let characters = getAllPublicCharacters();

        // 关键词搜索
        if (q) {
            const query = String(q).toLowerCase();
            characters = characters.filter(character =>
                character.name.toLowerCase().includes(query) ||
                character.description.toLowerCase().includes(query) ||
                (character.tags && character.tags.some(tag => tag.toLowerCase().includes(query))),
            );
        }

        // 上传者筛选
        if (uploader) {
            characters = characters.filter(character =>
                character.uploader.handle === uploader ||
                character.uploader.name === uploader,
            );
        }

        response.json(characters);
    } catch (error) {
        console.error('Error searching public characters:', error);
        response.status(500).json({ error: 'Failed to search characters' });
    }
});

// 下载角色卡（增加下载计数）
router.post('/:characterId/download', async function (request, response) {
    try {
        const { characterId } = request.params;
        const character = getPublicCharacter(characterId);

        if (!character) {
            return response.status(404).json({ error: 'Character not found' });
        }

        // 增加下载计数
        character.downloads = (character.downloads || 0) + 1;
        savePublicCharacter(character);

        response.json({
            success: true,
            character_data: character.character_data,
        });
    } catch (error) {
        console.error('Error downloading public character:', error);
        response.status(500).json({ error: 'Failed to download character' });
    }
});

// 获取角色卡头像
router.get('/avatar/:filename', async function (request, response) {
    try {
        const { filename } = request.params;
        const decodedFilename = decodeURIComponent(filename);

        // 构造头像文件路径
        const avatarPath = path.join(PUBLIC_CHARACTERS_DIR, decodedFilename);

        if (!fs.existsSync(avatarPath)) {
            return response.status(404).json({ error: 'Avatar not found' });
        }

        // 设置正确的Content-Type
        const ext = path.extname(decodedFilename).toLowerCase();
        let contentType = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') {
            contentType = 'image/jpeg';
        } else if (ext === '.gif') {
            contentType = 'image/gif';
        } else if (ext === '.webp') {
            contentType = 'image/webp';
        }

        response.setHeader('Content-Type', contentType);
        response.setHeader('Cache-Control', 'public, max-age=31536000'); // 缓存1年

        const avatarBuffer = fs.readFileSync(avatarPath);
        response.send(avatarBuffer);
    } catch (error) {
        console.error('Error serving avatar:', error);
        response.status(500).json({ error: 'Failed to serve avatar' });
    }
});

// 导入角色卡到用户角色库
router.post('/:characterId/import', async function (request, response) {
    try {
        if (!request.user) {
            return response.status(401).json({ error: 'Authentication required' });
        }

        const { characterId } = request.params;
        const character = getPublicCharacter(characterId);

        if (!character) {
            return response.status(404).json({ error: 'Character not found' });
        }

        // 导入角色卡到用户角色库
        const importResult = await importCharacterToUserLibrary(character, request.user);

        if (importResult.success) {
            // 增加下载计数
            character.downloads = (character.downloads || 0) + 1;
            savePublicCharacter(character);

            response.json({
                success: true,
                message: '角色卡导入成功',
                file_name: importResult.fileName,
            });
        } else {
            response.status(500).json({ error: importResult.error || '导入失败' });
        }
    } catch (error) {
        console.error('Error importing character:', error);
        response.status(500).json({ error: 'Failed to import character' });
    }
});

// 导入角色卡到用户角色库的辅助函数 - 使用与主后台相同的导入逻辑
async function importCharacterToUserLibrary(character, user) {
    try {
        const { getUserDirectories } = await import('../users.js');
        const userDirs = getUserDirectories(user.profile.handle);

        // 确保用户角色库目录存在
        if (!fs.existsSync(userDirs.characters)) {
            fs.mkdirSync(userDirs.characters, { recursive: true });
        }

        // 获取角色卡文件路径
        let characterFilePath = null;
        if (character.avatar && character.avatar !== 'img/ai4.png') {
            characterFilePath = path.join(PUBLIC_CHARACTERS_DIR, character.avatar);
        }

        if (!characterFilePath || !fs.existsSync(characterFilePath)) {
            throw new Error('角色卡文件不存在');
        }

        // 根据文件格式处理角色卡数据
        const extension = path.extname(characterFilePath).toLowerCase().substring(1);
        let jsonData;
        let avatarBuffer;

        if (extension === 'png') {
            // PNG格式：从tEXt块提取角色数据
            const characterCardParser = await import('../character-card-parser.js');
            const { read } = characterCardParser;
            const pngBuffer = fs.readFileSync(characterFilePath);
            const metaJson = read(pngBuffer);
            try {
                jsonData = JSON.parse(metaJson);
            } catch (e) {
                throw new Error('PNG内嵌角色数据不是有效的JSON');
            }
            avatarBuffer = pngBuffer;
        } else if (extension === 'json') {
            // JSON格式：直接读取角色数据
            const fileContent = fs.readFileSync(characterFilePath, 'utf8');
            jsonData = JSON.parse(fileContent);
            // 使用默认头像
            const fallback = path.join(process.cwd(), 'public', 'img', 'ai4.png');
            avatarBuffer = fs.existsSync(fallback) ? fs.readFileSync(fallback) : null;
        } else if (extension === 'yaml' || extension === 'yml') {
            // YAML格式：解析YAML数据
            const yamlModule = await import('js-yaml');
            const yaml = yamlModule.default || yamlModule;
            const fileContent = fs.readFileSync(characterFilePath, 'utf8');
            jsonData = yaml.load(fileContent);
            // 使用默认头像
            const fallback = path.join(process.cwd(), 'public', 'img', 'ai4.png');
            avatarBuffer = fs.existsSync(fallback) ? fs.readFileSync(fallback) : null;
        } else {
            throw new Error(`不支持的文件格式: ${extension}`);
        }

        const timestamp = Date.now();
        const baseFileName = sanitize(jsonData.name || character.name || 'character');
        const sanitizedFileName = sanitize(`${baseFileName}_${timestamp}`);

        // 如果没有头像，使用默认头像
        if (!avatarBuffer || avatarBuffer.length === 0) {
            const fallback = path.join(process.cwd(), 'public', 'img', 'ai4.png');
            if (fs.existsSync(fallback)) {
                avatarBuffer = fs.readFileSync(fallback);
            } else {
                throw new Error('无法找到默认头像文件');
            }
        }

        // 将角色数据写入PNG（统一格式）
        const characterCardParser = await import('../character-card-parser.js');
        const { write } = characterCardParser;
        const newPng = write(avatarBuffer, JSON.stringify(jsonData));
        const outPath = path.join(userDirs.characters, `${sanitizedFileName}.png`);
        writeFileAtomicSync(outPath, newPng);

        const chatsPath = path.join(userDirs.chats, sanitizedFileName);
        if (!fs.existsSync(chatsPath)) {
            fs.mkdirSync(chatsPath, { recursive: true });
        }

        console.info(`Character ${character.name} imported by user ${user.profile.handle}`);
        return { success: true, fileName: sanitizedFileName };
    } catch (error) {
        console.error('Error importing character to user library:', error);
        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * 生成评论ID
 * @returns {string} 评论ID
 */
function generateCommentId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * 获取角色卡评论文件路径
 * @param {string} characterId 角色卡ID
 * @returns {string} 评论文件路径
 */
function getCommentsFilePath(characterId) {
    return path.join(CHARACTER_COMMENTS_DIR, `${characterId}_comments.json`);
}

/**
 * 获取角色卡评论
 * @param {string} characterId 角色卡ID
 * @returns {Array} 评论列表
 */
function getCharacterComments(characterId) {
    try {
        const commentsPath = getCommentsFilePath(characterId);
        if (!fs.existsSync(commentsPath)) {
            return [];
        }

        const commentsData = fs.readFileSync(commentsPath, 'utf8');
        return JSON.parse(commentsData);
    } catch (error) {
        console.error('Error getting character comments:', error);
        return [];
    }
}

/**
 * 保存角色卡评论
 * @param {string} characterId 角色卡ID
 * @param {Array} comments 评论列表
 * @returns {boolean} 是否成功
 */
function saveCharacterComments(characterId, comments) {
    try {
        const commentsPath = getCommentsFilePath(characterId);
        writeFileAtomicSync(commentsPath, JSON.stringify(comments, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving character comments:', error);
        return false;
    }
}

/**
 * 在评论列表中查找评论
 * @param {Array} comments 评论列表
 * @param {string} commentId 评论ID
 * @returns {object|null} 找到的评论
 */
function findCommentById(comments, commentId) {
    for (const comment of comments) {
        if (comment.id === commentId) {
            return comment;
        }
        if (comment.replies && comment.replies.length > 0) {
            const found = findCommentById(comment.replies, commentId);
            if (found) {
                return found;
            }
        }
    }
    return null;
}

// 获取角色卡评论
router.get('/:characterId/comments', async function (request, response) {
    try {
        const { characterId } = request.params;

        // 检查角色卡是否存在
        const character = getPublicCharacter(characterId);
        if (!character) {
            return response.status(404).json({ error: 'Character not found' });
        }

        const comments = getCharacterComments(characterId);
        response.json(comments);
    } catch (error) {
        console.error('Error getting character comments:', error);
        response.status(500).json({ error: 'Failed to get comments' });
    }
});

// 添加评论
router.post('/:characterId/comments', async function (request, response) {
    try {
        const { characterId } = request.params;
        const { content, parentId } = request.body;

        if (!request.user) {
            return response.status(401).json({ error: 'Authentication required' });
        }

        // 检查角色卡是否存在
        const character = getPublicCharacter(characterId);
        if (!character) {
            return response.status(404).json({ error: 'Character not found' });
        }

        if (!content || !content.trim()) {
            return response.status(400).json({ error: 'Comment content is required' });
        }

        const comments = getCharacterComments(characterId);
        const newComment = {
            id: generateCommentId(),
            content: content.trim(),
            author: {
                handle: request.user.profile.handle,
                name: request.user.profile.name,
            },
            created_at: humanizedISO8601DateTime(),
            replies: [],
        };

        if (parentId) {
            // 这是一个回复
            const parentComment = findCommentById(comments, parentId);
            if (!parentComment) {
                return response.status(404).json({ error: 'Parent comment not found' });
            }
            parentComment.replies.push(newComment);
        } else {
            // 这是一个顶级评论
            comments.push(newComment);
        }

        if (saveCharacterComments(characterId, comments)) {
            console.info(`Comment added to character ${characterId} by ${request.user.profile.handle}`);
            response.json(newComment);
        } else {
            response.status(500).json({ error: 'Failed to save comment' });
        }
    } catch (error) {
        console.error('Error adding comment:', error);
        response.status(500).json({ error: 'Failed to add comment' });
    }
});

// 删除评论
router.delete('/:characterId/comments/:commentId', async function (request, response) {
    try {
        const { characterId, commentId } = request.params;

        if (!request.user) {
            return response.status(401).json({ error: 'Authentication required' });
        }

        // 检查角色卡是否存在
        const character = getPublicCharacter(characterId);
        if (!character) {
            return response.status(404).json({ error: 'Character not found' });
        }

        const comments = getCharacterComments(characterId);
        const comment = findCommentById(comments, commentId);

        if (!comment) {
            return response.status(404).json({ error: 'Comment not found' });
        }

        // 检查权限：只有评论作者或管理员可以删除
        const isAuthor = comment.author.handle === request.user.profile.handle;
        const isAdmin = request.user.profile.admin;

        if (!isAuthor && !isAdmin) {
            return response.status(403).json({ error: 'Permission denied' });
        }

        // 删除评论的递归函数
        function removeComment(commentsList, targetId) {
            for (let i = 0; i < commentsList.length; i++) {
                if (commentsList[i].id === targetId) {
                    commentsList.splice(i, 1);
                    return true;
                }
                if (commentsList[i].replies && removeComment(commentsList[i].replies, targetId)) {
                    return true;
                }
            }
            return false;
        }

        if (removeComment(comments, commentId)) {
            if (saveCharacterComments(characterId, comments)) {
                console.info(`Comment ${commentId} deleted by ${request.user.profile.handle}`);
                response.json({ success: true });
            } else {
                response.status(500).json({ error: 'Failed to save changes' });
            }
        } else {
            response.status(404).json({ error: 'Comment not found' });
        }
    } catch (error) {
        console.error('Error deleting comment:', error);
        response.status(500).json({ error: 'Failed to delete comment' });
    }
});
