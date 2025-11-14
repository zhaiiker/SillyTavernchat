import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';

import mime from 'mime-types';
import express from 'express';
import sanitize from 'sanitize-filename';
import { Jimp, JimpMime } from '../jimp.js';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { getConfigValue } from '../util.js';

const thumbnailsEnabled = !!getConfigValue('thumbnails.enabled', true, 'boolean');
const quality = Math.min(100, Math.max(1, parseInt(getConfigValue('thumbnails.quality', 95, 'number'))));
const pngFormat = String(getConfigValue('thumbnails.format', 'jpg')).toLowerCase().trim() === 'png';

/**
 * @typedef {'bg' | 'avatar' | 'persona'} ThumbnailType
 */

/** @type {Record<string, number[]>} */
export const dimensions = {
    'bg': getConfigValue('thumbnails.dimensions.bg', [160, 90]),
    'avatar': getConfigValue('thumbnails.dimensions.avatar', [96, 144]),
    'persona': getConfigValue('thumbnails.dimensions.persona', [96, 144]),
};

/**
 * Gets a path to thumbnail folder based on the type.
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {ThumbnailType} type Thumbnail type
 * @returns {string} Path to the thumbnails folder
 */
function getThumbnailFolder(directories, type) {
    let thumbnailFolder;

    switch (type) {
        case 'bg':
            thumbnailFolder = directories.thumbnailsBg;
            break;
        case 'avatar':
            thumbnailFolder = directories.thumbnailsAvatar;
            break;
        case 'persona':
            thumbnailFolder = directories.thumbnailsPersona;
            break;
    }

    return thumbnailFolder;
}

/**
 * Gets a path to the original images folder based on the type.
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {ThumbnailType} type Thumbnail type
 * @returns {string} Path to the original images folder
 */
function getOriginalFolder(directories, type) {
    let originalFolder;

    switch (type) {
        case 'bg':
            originalFolder = directories.backgrounds;
            break;
        case 'avatar':
            originalFolder = directories.characters;
            break;
        case 'persona':
            originalFolder = directories.avatars;
            break;
    }

    return originalFolder;
}

/**
 * Removes the generated thumbnail from the disk.
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {ThumbnailType} type Type of the thumbnail
 * @param {string} file Name of the file
 */
export function invalidateThumbnail(directories, type, file) {
    const folder = getThumbnailFolder(directories, type);
    if (folder === undefined) throw new Error('Invalid thumbnail type');

    const pathToThumbnail = path.join(folder, sanitize(file));

    if (fs.existsSync(pathToThumbnail)) {
        fs.unlinkSync(pathToThumbnail);
    }
}

/**
 * Generates a thumbnail for the given file.
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {ThumbnailType} type Type of the thumbnail
 * @param {string} file Name of the file
 * @returns
 */
async function generateThumbnail(directories, type, file) {
    let thumbnailFolder = getThumbnailFolder(directories, type);
    let originalFolder = getOriginalFolder(directories, type);
    if (thumbnailFolder === undefined || originalFolder === undefined) throw new Error('Invalid thumbnail type');
    const pathToCachedFile = path.join(thumbnailFolder, file);
    const pathToOriginalFile = path.join(originalFolder, file);

    const cachedFileExists = fs.existsSync(pathToCachedFile);
    const originalFileExists = fs.existsSync(pathToOriginalFile);

    // to handle cases when original image was updated after thumb creation
    let shouldRegenerate = false;

    if (cachedFileExists && originalFileExists) {
        const originalStat = fs.statSync(pathToOriginalFile);
        const cachedStat = fs.statSync(pathToCachedFile);

        if (originalStat.mtimeMs > cachedStat.ctimeMs) {
            //console.warn('Original file changed. Regenerating thumbnail...');
            shouldRegenerate = true;
        }
    }

    if (cachedFileExists && !shouldRegenerate) {
        return pathToCachedFile;
    }

    if (!originalFileExists) {
        return null;
    }

    try {
        let buffer;

        try {
            const size = dimensions[type];
            const image = await Jimp.read(pathToOriginalFile);
            const width = !isNaN(size?.[0]) && size?.[0] > 0 ? size[0] : image.bitmap.width;
            const height = !isNaN(size?.[1]) && size?.[1] > 0 ? size[1] : image.bitmap.height;
            image.cover({ w: width, h: height });
            buffer = pngFormat
                ? await image.getBuffer(JimpMime.png)
                : await image.getBuffer(JimpMime.jpeg, { quality: quality, jpegColorSpace: 'ycbcr' });
        }
        catch (inner) {
            console.warn(`Thumbnailer can not process the image: ${pathToOriginalFile}. Using original size`, inner);
            buffer = fs.readFileSync(pathToOriginalFile);
        }

        writeFileAtomicSync(pathToCachedFile, buffer);
    }
    catch (outer) {
        return null;
    }

    return pathToCachedFile;
}

/**
 * Ensures that the thumbnail cache for backgrounds is valid.
 * @param {import('../users.js').UserDirectoryList[]} directoriesList User directories
 * @returns {Promise<void>} Promise that resolves when the cache is validated
 */
export async function ensureThumbnailCache(directoriesList) {
    // 检查是否跳过启动时的缩略图生成（懒加载模式）
    const skipStartupGeneration = getConfigValue('thumbnails.skipStartupGeneration', false, 'boolean');

    if (skipStartupGeneration) {
        const totalUsers = directoriesList.length;
        console.info(`跳过启动时的缩略图生成 (懒加载模式已启用，共 ${totalUsers} 个用户)`);
        console.info('缩略图将在首次请求时按需生成');
        return;
    }

    // 如果未启用缩略图功能，也跳过
    if (!thumbnailsEnabled) {
        console.info('缩略图生成已禁用');
        return;
    }

    const totalUsers = directoriesList.length;
    let usersNeedingThumbnails = [];

    // 先快速检查哪些用户需要生成缩略图
    for (const directories of directoriesList) {
        const cacheFiles = fs.readdirSync(directories.thumbnailsBg);
        if (cacheFiles.length === 0) {
            const bgFiles = fs.readdirSync(directories.backgrounds);
            if (bgFiles.length > 0) {
                usersNeedingThumbnails.push({ directories, bgFiles });
            }
        }
    }

    if (usersNeedingThumbnails.length === 0) {
        return;
    }

    console.info(`正在为 ${usersNeedingThumbnails.length} 个用户生成缩略图缓存...`);
    console.info(`提示: 如需加快启动速度，可在 config.yaml 中设置 thumbnails.skipStartupGeneration: true`);

    // 并发处理所有用户的缩略图生成，每批处理10个用户（缩略图生成比较耗资源）
    const BATCH_SIZE = 10;
    let processed = 0;

    for (let i = 0; i < usersNeedingThumbnails.length; i += BATCH_SIZE) {
        const batch = usersNeedingThumbnails.slice(i, i + BATCH_SIZE);

        // 并发处理当前批次的所有用户
        await Promise.all(batch.map(async ({ directories, bgFiles }) => {
            const tasks = bgFiles.map(file => generateThumbnail(directories, 'bg', file));
            await Promise.all(tasks);
        }));

        processed += batch.length;
        console.info(`  缩略图生成进度: ${Math.min(processed, usersNeedingThumbnails.length)}/${usersNeedingThumbnails.length}`);
    }

    const totalThumbnails = usersNeedingThumbnails.reduce((sum, { bgFiles }) => sum + bgFiles.length, 0);
    console.info(`✓ 完成！共生成 ${totalThumbnails} 个预览图像`);
}

export const router = express.Router();

// Important: This route must be mounted as '/thumbnail'. It is used in the client code and saved to chat files.
router.get('/', async function (request, response) {
    try{
        if (typeof request.query.file !== 'string' || typeof request.query.type !== 'string') {
            return response.sendStatus(400);
        }

        const type = request.query.type;
        const file = sanitize(request.query.file);

        if (!type || !file) {
            return response.sendStatus(400);
        }

        if (!(type === 'bg' || type === 'avatar' || type === 'persona')) {
            return response.sendStatus(400);
        }

        if (sanitize(file) !== file) {
            console.error('Malicious filename prevented');
            return response.sendStatus(403);
        }

        if (!thumbnailsEnabled) {
            const folder = getOriginalFolder(request.user.directories, type);

            if (folder === undefined) {
                return response.sendStatus(400);
            }

            const pathToOriginalFile = path.join(folder, file);
            if (!fs.existsSync(pathToOriginalFile)) {
                return response.sendStatus(404);
            }
            const contentType = mime.lookup(pathToOriginalFile) || 'image/png';
            const originalFile = await fsPromises.readFile(pathToOriginalFile);
            response.setHeader('Content-Type', contentType);
            return response.send(originalFile);
        }

        const pathToCachedFile = await generateThumbnail(request.user.directories, type, file);

        if (!pathToCachedFile) {
            return response.sendStatus(404);
        }

        if (!fs.existsSync(pathToCachedFile)) {
            return response.sendStatus(404);
        }

        const contentType = mime.lookup(pathToCachedFile) || 'image/jpeg';
        const cachedFile = await fsPromises.readFile(pathToCachedFile);
        response.setHeader('Content-Type', contentType);
        return response.send(cachedFile);
    } catch (error) {
        console.error('Failed getting thumbnail', error);
        return response.sendStatus(500);
    }
});
