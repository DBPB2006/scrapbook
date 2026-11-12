const path = require("path");
const crypto = require("crypto");
const { PassThrough } = require("stream");
const { Upload } = require("@aws-sdk/lib-storage");
const { S3Client, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

let s3Client = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });

const DEFAULT_MAX_UPLOAD_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_MAX_PROFILE_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB (matches client signup hint)
const DEFAULT_MAX_UPLOAD_FILES = 10;
const MAGIC_PEEK_BYTES = 512;

const MIME_ALIASES = Object.freeze({
    'image/jpg': 'image/jpeg',
    'image/pjpeg': 'image/jpeg',
    'audio/mp3': 'audio/mpeg',
    'audio/x-wav': 'audio/wav',
    'audio/wave': 'audio/wav',
    'audio/oga': 'audio/ogg',
    'audio/m4a': 'audio/mp4',
    'audio/x-m4a': 'audio/mp4',
    'audio/aacp': 'audio/aac'
});

const SUPPORTED_MEDIA_SPECS = Object.freeze({
    'image/jpeg': {
        category: 'image',
        ext: '.jpg',
        allowedExts: ['.jpg', '.jpeg']
    },
    'image/png': {
        category: 'image',
        ext: '.png',
        allowedExts: ['.png']
    },
    'image/gif': {
        category: 'image',
        ext: '.gif',
        allowedExts: ['.gif']
    },
    'image/webp': {
        category: 'image',
        ext: '.webp',
        allowedExts: ['.webp']
    },
    'video/mp4': {
        category: 'video',
        ext: '.mp4',
        allowedExts: ['.mp4', '.m4v']
    },
    'video/webm': {
        category: 'video',
        ext: '.webm',
        allowedExts: ['.webm']
    },
    'video/quicktime': {
        category: 'video',
        ext: '.mov',
        allowedExts: ['.mov']
    },
    'video/ogg': {
        category: 'video',
        ext: '.ogv',
        allowedExts: ['.ogv', '.ogg']
    },
    'audio/mpeg': {
        category: 'audio',
        ext: '.mp3',
        allowedExts: ['.mp3']
    },
    'audio/wav': {
        category: 'audio',
        ext: '.wav',
        allowedExts: ['.wav']
    },
    'audio/ogg': {
        category: 'audio',
        ext: '.ogg',
        allowedExts: ['.ogg', '.oga']
    },
    'audio/webm': {
        category: 'audio',
        ext: '.webm',
        allowedExts: ['.webm']
    },
    'audio/mp4': {
        category: 'audio',
        ext: '.m4a',
        allowedExts: ['.m4a', '.mp4']
    },
    'audio/aac': {
        category: 'audio',
        ext: '.aac',
        allowedExts: ['.aac', '.adts']
    },
    'application/pdf': {
        category: 'document',
        ext: '.pdf',
        allowedExts: ['.pdf']
    }
});

const DANGEROUS_EXTENSIONS = new Set([
    '.exe', '.dll', '.bat', '.cmd', '.sh', '.bash', '.zsh', '.ps1', '.vbs',
    '.js', '.mjs', '.cjs', '.html', '.htm', '.xhtml', '.svg', '.svgz', '.xml',
    '.php', '.phtml', '.jsp', '.asp', '.aspx', '.py', '.rb', '.pl', '.cgi',
    '.jar', '.com', '.msi', '.scr', '.app', '.deb', '.rpm', '.elf', '.bin'
]);

class UploadValidationError extends Error {
    constructor(statusCode, code, message) {
        super(message);
        this.name = 'UploadValidationError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

function parsePositiveInt(val, fallback) {
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getMaxUploadFileSize() {
    return parsePositiveInt(process.env.MAX_UPLOAD_FILE_SIZE_BYTES, DEFAULT_MAX_UPLOAD_FILE_SIZE_BYTES);
}

function getMaxProfileImageSize() {
    if (process.env.MAX_PROFILE_IMAGE_SIZE_BYTES) {
        return parsePositiveInt(process.env.MAX_PROFILE_IMAGE_SIZE_BYTES, DEFAULT_MAX_PROFILE_IMAGE_SIZE_BYTES);
    }
    if (process.env.MAX_UPLOAD_FILE_SIZE_BYTES) {
        return parsePositiveInt(process.env.MAX_UPLOAD_FILE_SIZE_BYTES, DEFAULT_MAX_PROFILE_IMAGE_SIZE_BYTES);
    }
    return DEFAULT_MAX_PROFILE_IMAGE_SIZE_BYTES;
}

function getMaxUploadFiles() {
    return parsePositiveInt(process.env.MAX_UPLOAD_FILES, DEFAULT_MAX_UPLOAD_FILES);
}

function normalizeMimeType(rawMime) {
    if (!rawMime || typeof rawMime !== 'string') return '';
    const base = rawMime.split(';')[0].trim().toLowerCase();
    return MIME_ALIASES[base] || base;
}

function getAllowedMimeTypes(category = 'media') {
    const allowedCategories = category === 'image'
        ? new Set(['image'])
        : new Set(['image', 'video', 'audio', 'document']);

    const defaultMimes = Object.keys(SUPPORTED_MEDIA_SPECS).filter(mime =>
        allowedCategories.has(SUPPORTED_MEDIA_SPECS[mime].category)
    );

    const envOverride = process.env.ALLOWED_MEDIA_MIME_TYPES;
    if (typeof envOverride === 'string' && envOverride.trim()) {
        const requested = envOverride
            .split(',')
            .map(m => normalizeMimeType(m))
            .filter(m => m && SUPPORTED_MEDIA_SPECS[m] && allowedCategories.has(SUPPORTED_MEDIA_SPECS[m].category));
        if (requested.length > 0) {
            return new Set(requested);
        }
    }

    return new Set(defaultMimes);
}

function isExecutableOrUnsafeContent(buf) {
    if (!Buffer.isBuffer(buf) || buf.length === 0) return false;

    // PE/MZ Windows executables (.exe, .dll, .scr, .com)
    if (buf.length >= 2 && buf[0] === 0x4D && buf[1] === 0x5A) return true;
    // ELF Linux/Unix executables
    if (buf.length >= 4 && buf[0] === 0x7F && buf[1] === 0x45 && buf[2] === 0x4C && buf[3] === 0x46) return true;
    // Mach-O executables / universal binaries
    if (buf.length >= 4) {
        const hex4 = buf.subarray(0, 4).toString('hex').toLowerCase();
        if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'].includes(hex4)) return true;
    }
    // Shell/script shebang (#!)
    if (buf.length >= 2 && buf[0] === 0x23 && buf[1] === 0x21) return true;
    // ZIP/JAR/APK archives
    if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B && (buf[2] === 0x03 || buf[2] === 0x05)) return true;

    // Active HTML/SVG/XML/PHP payloads masquerading as media
    const headText = buf.subarray(0, Math.min(buf.length, 256)).toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
    if (/^(<!doctype\b|<html\b|<script\b|<svg\b|<\?xml\b|<\?php\b|javascript:)/.test(headText)) {
        return true;
    }

    return false;
}

function validateMagicBytes(buf, normalizedMime) {
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
        return { valid: false, reason: 'Uploaded file is empty.' };
    }
    if (isExecutableOrUnsafeContent(buf)) {
        return { valid: false, reason: 'Executable or active script content is not allowed.' };
    }

    switch (normalizedMime) {
        case 'image/jpeg':
            return (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF)
                ? { valid: true }
                : { valid: false, reason: 'File signature does not match JPEG image format.' };
        case 'image/png':
            return (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])))
                ? { valid: true }
                : { valid: false, reason: 'File signature does not match PNG image format.' };
        case 'image/gif': {
            const hdr = buf.length >= 6 ? buf.subarray(0, 6).toString('ascii') : '';
            return (hdr === 'GIF87a' || hdr === 'GIF89a')
                ? { valid: true }
                : { valid: false, reason: 'File signature does not match GIF image format.' };
        }
        case 'image/webp':
            return (buf.length >= 12 &&
                buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
                buf.subarray(8, 12).toString('ascii') === 'WEBP')
                ? { valid: true }
                : { valid: false, reason: 'File signature does not match WebP image format.' };
        case 'video/mp4':
        case 'audio/mp4':
            return (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp')
                ? { valid: true }
                : { valid: false, reason: 'File signature does not match MP4/ISO media container.' };
        case 'video/quicktime': {
            const box = buf.length >= 8 ? buf.subarray(4, 8).toString('ascii') : '';
            return (['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(box))
                ? { valid: true }
                : { valid: false, reason: 'File signature does not match QuickTime MOV format.' };
        }
        case 'video/webm':
        case 'audio/webm':
            return (buf.length >= 4 && buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3)
                ? { valid: true }
                : { valid: false, reason: 'File signature does not match WebM format.' };
        case 'video/ogg':
        case 'audio/ogg':
            return (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'OggS')
                ? { valid: true }
                : { valid: false, reason: 'File signature does not match Ogg format.' };
        case 'audio/mpeg': {
            const isId3 = buf.length >= 3 && buf.subarray(0, 3).toString('ascii') === 'ID3';
            const isSync = buf.length >= 2 &&
                buf[0] === 0xFF &&
                (buf[1] & 0xE0) === 0xE0 &&
                (buf[1] & 0x18) !== 0x08 &&
                (buf[1] & 0x06) !== 0x00 &&
                buf[1] !== 0xD8 &&
                buf[1] !== 0xD9;
            return (isId3 || isSync)
                ? { valid: true }
                : { valid: false, reason: 'File signature does not match MP3 audio format.' };
        }
        case 'audio/wav':
            return (buf.length >= 12 &&
                buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
                buf.subarray(8, 12).toString('ascii') === 'WAVE')
                ? { valid: true }
                : { valid: false, reason: 'File signature does not match WAV audio format.' };
        case 'audio/aac': {
            const isAdts = buf.length >= 2 && buf[0] === 0xFF && (buf[1] & 0xF6) === 0xF0;
            const isAdif = buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'ADIF';
            return (isAdts || isAdif)
                ? { valid: true }
                : { valid: false, reason: 'File signature does not match AAC audio format.' };
        }
        case 'application/pdf':
            return (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-')
                ? { valid: true }
                : { valid: false, reason: 'File signature does not match PDF format.' };
        default:
            return { valid: false, reason: 'Unsupported file type.' };
    }
}

function validateDeclaredUpload(file, category = 'media') {
    if (!file || typeof file !== 'object') {
        return {
            valid: false,
            error: new UploadValidationError(400, 'INVALID_UPLOAD', 'Invalid uploaded file.')
        };
    }

    const normalizedMime = normalizeMimeType(file.mimetype);
    const allowedMimes = getAllowedMimeTypes(category);
    if (!normalizedMime || !allowedMimes.has(normalizedMime)) {
        return {
            valid: false,
            error: new UploadValidationError(415, 'UNSUPPORTED_MEDIA_TYPE', `Unsupported file type: ${normalizedMime || 'unknown'}`)
        };
    }

    const spec = SUPPORTED_MEDIA_SPECS[normalizedMime];
    const safeBaseName = sanitizeFileName(file.originalname || 'upload');
    const ext = path.extname(safeBaseName).toLowerCase();

    if (ext && DANGEROUS_EXTENSIONS.has(ext)) {
        return {
            valid: false,
            error: new UploadValidationError(415, 'EXECUTABLE_REJECTED', 'Executable or script file extensions are not allowed.')
        };
    }

    if (ext && spec && !spec.allowedExts.includes(ext)) {
        return {
            valid: false,
            error: new UploadValidationError(415, 'EXTENSION_MIME_MISMATCH', `File extension '${ext}' does not match declared type '${normalizedMime}'.`)
        };
    }

    return { valid: true, normalizedMime, spec, safeBaseName };
}

function normalizeS3Prefix(prefix) {
    if (!prefix || typeof prefix !== 'string') return '';
    const cleaned = prefix
        .replace(/\\/g, '/')
        .replace(/\.\.+/g, '')
        .replace(/^\/+/, '')
        .replace(/\/+/g, '/');
    if (!cleaned) return '';
    return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
}

function generateSafeS3Key(prefix, canonicalExt) {
    const safePrefix = normalizeS3Prefix(prefix);
    const ext = typeof canonicalExt === 'string' && /^\.[a-z0-9]+$/.test(canonicalExt) ? canonicalExt : '';
    const randomToken = crypto.randomBytes(12).toString('hex');
    return `${safePrefix}${Date.now()}-${randomToken}${ext}`;
}

function S3Storage(opts = {}) {
    this.bucket = opts.bucket || process.env.AWS_S3_BUCKET || 'default-bucket';
    this.prefix = normalizeS3Prefix(opts.prefix || '');
    this.category = opts.category || 'media';
    this.maxFileSize = opts.maxFileSize || null;
    this.s3Client = opts.s3Client || null;
}

S3Storage.prototype._getClient = function _getClient() {
    return this.s3Client || s3Client;
};

S3Storage.prototype._handleFile = function _handleFile(req, file, cb) {
    const declared = validateDeclaredUpload(file, this.category);
    if (!declared.valid) {
        if (file && file.stream) file.stream.resume();
        return cb(declared.error);
    }

    const maxBytes = this.maxFileSize || (this.category === 'image' ? getMaxProfileImageSize() : getMaxUploadFileSize());
    const client = this._getClient();
    const bucket = this.bucket || process.env.AWS_S3_BUCKET || 'default-bucket';
    const key = generateSafeS3Key(this.prefix, declared.spec.ext);
    const safeDisplayName = sanitizeFileName(file.originalname || `upload${declared.spec.ext}`);
    const canonicalMime = declared.normalizedMime;

    let finished = false;
    let totalBytes = 0;
    let headerVerified = false;
    let headerChunks = [];
    let headerLength = 0;
    let upload = null;
    let uploadPromise = null;
    let passThrough = null;

    const fail = async (err) => {
        if (finished) return;
        finished = true;
        if (file.stream) {
            file.stream.removeAllListeners('data');
            file.stream.removeAllListeners('end');
            file.stream.removeAllListeners('error');
            file.stream.resume();
        }
        if (passThrough) {
            passThrough.destroy();
        }
        if (upload && typeof upload.abort === 'function') {
            try {
                await upload.abort();
            } catch (abortErr) {
                // ignore abort errors during cleanup
            }
        }
        if (uploadPromise) {
            try {
                await deleteS3Object(key, bucket, client);
            } catch (delErr) {
                // ignore cleanup errors on failed upload
            }
        }
        cb(err);
    };

    const startS3Upload = (initialBuf) => {
        passThrough = new PassThrough();
        upload = new Upload({
            client,
            params: {
                Bucket: bucket,
                Key: key,
                Body: passThrough,
                ContentType: canonicalMime
            }
        });
        uploadPromise = upload.done();
        uploadPromise.catch((err) => fail(err));
        passThrough.write(initialBuf);
    };

    file.stream.on('data', (chunk) => {
        if (finished) return;
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
            fail(new UploadValidationError(413, 'LIMIT_FILE_SIZE', `Uploaded file exceeds maximum allowed size of ${maxBytes} bytes.`));
            return;
        }

        if (!headerVerified) {
            headerChunks.push(chunk);
            headerLength += chunk.length;
            if (headerLength >= MAGIC_PEEK_BYTES) {
                const headerBuf = Buffer.concat(headerChunks, headerLength);
                headerChunks = [];
                const magic = validateMagicBytes(headerBuf, canonicalMime);
                if (!magic.valid) {
                    fail(new UploadValidationError(415, 'SIGNATURE_MISMATCH', magic.reason));
                    return;
                }
                headerVerified = true;
                startS3Upload(headerBuf);
            }
        } else if (passThrough) {
            if (!passThrough.write(chunk)) {
                file.stream.pause();
                passThrough.once('drain', () => {
                    if (!finished) file.stream.resume();
                });
            }
        }
    });

    file.stream.on('end', () => {
        if (finished) return;

        if (!headerVerified) {
            const headerBuf = Buffer.concat(headerChunks, headerLength);
            headerChunks = [];
            const magic = validateMagicBytes(headerBuf, canonicalMime);
            if (!magic.valid) {
                const status = headerBuf.length === 0 ? 400 : 415;
                const code = headerBuf.length === 0 ? 'EMPTY_FILE' : 'SIGNATURE_MISMATCH';
                fail(new UploadValidationError(status, code, magic.reason));
                return;
            }
            headerVerified = true;
            startS3Upload(headerBuf);
        }

        if (passThrough) {
            passThrough.end();
        }

        Promise.resolve(uploadPromise)
            .then(() => {
                if (finished) return;
                finished = true;
                cb(null, {
                    provider: 's3',
                    key: key,
                    mimeType: canonicalMime,
                    fileName: safeDisplayName,
                    size: totalBytes
                });
            })
            .catch(err => {
                fail(err);
            });
    });

    file.stream.on('error', (err) => {
        fail(err);
    });
};

S3Storage.prototype._removeFile = function _removeFile(req, file, cb) {
    if (file && file.key) {
        deleteS3Object(file.key, this.bucket, this._getClient())
            .then(() => cb(null))
            .catch(() => cb(null));
    } else {
        cb(null);
    }
};

function handleUploadError(err, req, res, next) {
    if (!err) return next();

    if (err instanceof UploadValidationError) {
        return res.status(err.statusCode || 400).json({ error: err.message, code: err.code });
    }

    if (err.name === 'MulterError') {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: 'Uploaded file exceeds the maximum allowed size limit.',
                code: 'LIMIT_FILE_SIZE'
            });
        }
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_PART_COUNT') {
            return res.status(400).json({
                error: err.message || 'Upload limit exceeded.',
                code: err.code
            });
        }
        return res.status(400).json({
            error: err.message || 'Invalid file upload.',
            code: err.code || 'UPLOAD_ERROR'
        });
    }

    return next(err);
}

function createUploadMiddleware(multerLib, opts = {}) {
    const category = opts.category || 'media';
    const fieldName = opts.fieldName || 'file';
    const multiple = Boolean(opts.multiple);

    return function uploadMiddleware(req, res, next) {
        const resolvedMaxSize = opts.maxFileSize || (category === 'image' ? getMaxProfileImageSize() : getMaxUploadFileSize());
        const resolvedMaxFiles = opts.maxCount || getMaxUploadFiles();
        const storage = new S3Storage({
            bucket: opts.bucket || process.env.AWS_S3_BUCKET || 'default-bucket',
            prefix: opts.prefix || '',
            category,
            maxFileSize: resolvedMaxSize,
            s3Client: opts.s3Client || null
        });

        const uploader = multerLib({
            storage,
            limits: {
                fileSize: resolvedMaxSize,
                files: multiple ? resolvedMaxFiles : 1
            },
            fileFilter: (r, file, cb) => {
                const check = validateDeclaredUpload(file, category);
                if (!check.valid) {
                    return cb(check.error);
                }
                cb(null, true);
            }
        });

        const handler = multiple ? uploader.array(fieldName, resolvedMaxFiles) : uploader.single(fieldName);
        handler(req, res, (err) => {
            if (err) {
                return handleUploadError(err, req, res, next);
            }
            next();
        });
    };
}

/**
 * Deletes an S3 object safely by key. Returns true if deleted or key is invalid/absent without throwing fatal errors.
 */
async function deleteS3Object(key, bucket = null, customClient = null) {
    if (!key || typeof key !== 'string' || !key.trim()) return false;
    const cleanKey = key.trim().replace(/^\/+/, '');
    if (cleanKey.includes('..')) return false;
    const targetBucket = bucket || process.env.AWS_S3_BUCKET || 'default-bucket';
    const client = customClient || s3Client;
    try {
        await client.send(new DeleteObjectCommand({
            Bucket: targetBucket,
            Key: cleanKey
        }));
        return true;
    } catch (err) {
        console.error(`Failed to delete S3 object '${cleanKey}':`, err.message);
        return false;
    }
}

async function deleteS3Objects(keys, bucket = null, customClient = null) {
    if (!Array.isArray(keys) || keys.length === 0) return [];
    const uniqueKeys = [...new Set(keys.filter(k => typeof k === 'string' && k.trim()))];
    const deleted = [];
    for (const key of uniqueKeys) {
        const ok = await deleteS3Object(key, bucket, customClient);
        if (ok) deleted.push(key);
    }
    return deleted;
}

function extractS3Keys(value, collected = new Set()) {
    if (!value) return Array.from(collected);
    if (Array.isArray(value)) {
        for (const item of value) extractS3Keys(item, collected);
        return Array.from(collected);
    }
    if (typeof value === 'object') {
        if (value.provider === 's3' && typeof value.key === 'string' && value.key.trim()) {
            collected.add(value.key.trim());
        }
        if (value.url && typeof value.url === 'object') extractS3Keys(value.url, collected);
        if (value.path && typeof value.path === 'object') extractS3Keys(value.path, collected);
        if (value.media) extractS3Keys(value.media, collected);
        if (value.attachments) extractS3Keys(value.attachments, collected);
        if (value.image) extractS3Keys(value.image, collected);
        if (value.profile_pic) extractS3Keys(value.profile_pic, collected);
        if (value.image_url) extractS3Keys(value.image_url, collected);
    }
    return Array.from(collected);
}

/**
 * Filters candidate S3 keys to return only those not referenced anywhere in MongoDB.
 */
async function filterUnreferencedS3Keys(mongodb, candidateKeys) {
    if (!Array.isArray(candidateKeys) || candidateKeys.length === 0) return [];
    const uniqueCandidates = [...new Set(candidateKeys.filter(k => typeof k === 'string' && k.trim()))];
    if (uniqueCandidates.length === 0) return [];

    if (!mongodb || typeof mongodb.isConnected !== 'function' || !mongodb.isConnected()) {
        console.warn('MongoDB disconnected; skipping S3 cleanup to avoid data loss.');
        return [];
    }

    const stillReferenced = new Set();
    const referenceQueries = [
        {
            colName: mongodb.COLLECTIONS.USERS,
            filter: {
                $or: [
                    { 'profile_pic.key': { $in: uniqueCandidates } },
                    { 'friends.image_url.key': { $in: uniqueCandidates } },
                    { profile_pic: { $in: uniqueCandidates } },
                    { 'friends.image_url': { $in: uniqueCandidates } }
                ]
            },
            projection: { _id: 0, profile_pic: 1, 'friends.image_url': 1 }
        },
        {
            colName: mongodb.COLLECTIONS.MEMORIES,
            filter: {
                $or: [
                    { 'media.url.key': { $in: uniqueCandidates } },
                    { 'media.path.key': { $in: uniqueCandidates } },
                    { 'media.key': { $in: uniqueCandidates } },
                    { 'image.key': { $in: uniqueCandidates } },
                    { 'image.url.key': { $in: uniqueCandidates } }
                ]
            },
            projection: { _id: 0, media: 1, image: 1 }
        },
        {
            colName: mongodb.COLLECTIONS.FRIEND_REQUESTS,
            filter: {
                $or: [
                    { 'image_url.key': { $in: uniqueCandidates } },
                    { image_url: { $in: uniqueCandidates } }
                ]
            },
            projection: { _id: 0, image_url: 1 }
        },
        {
            colName: mongodb.COLLECTIONS.SHARED_MEMORIES,
            filter: {
                $or: [
                    { 'attachments.key': { $in: uniqueCandidates } },
                    { 'attachments.url.key': { $in: uniqueCandidates } },
                    { 'media.url.key': { $in: uniqueCandidates } },
                    { 'media.path.key': { $in: uniqueCandidates } },
                    { 'media.key': { $in: uniqueCandidates } },
                    { 'image.key': { $in: uniqueCandidates } },
                    { 'image.url.key': { $in: uniqueCandidates } }
                ]
            },
            projection: { _id: 0, attachments: 1, media: 1, image: 1 }
        },
        {
            colName: mongodb.COLLECTIONS.TIME_CAPSULES,
            filter: {
                $or: [
                    { 'media.path.key': { $in: uniqueCandidates } },
                    { 'media.url.key': { $in: uniqueCandidates } },
                    { 'media.key': { $in: uniqueCandidates } }
                ]
            },
            projection: { _id: 0, media: 1 }
        }
    ];

    for (const { colName, filter, projection } of referenceQueries) {
        try {
            const col = mongodb.getCollection(colName);
            if (!col || typeof col.find !== 'function') {
                console.warn(`S3 reference check unavailable for ${colName}; skipping S3 cleanup to avoid data loss.`);
                return [];
            }
            const docs = await col.find(filter, { projection }).toArray();
            for (const doc of docs) {
                extractS3Keys(doc, stillReferenced);
            }
        } catch (err) {
            console.warn(`S3 reference check failed for ${colName}; skipping S3 cleanup to avoid data loss:`, err.message);
            return [];
        }
    }

    return uniqueCandidates.filter(k => !stillReferenced.has(k));
}

/**
 * Sanitizes a filename to protect against path traversal and header injection.
 */
function sanitizeFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') return 'download';
    const normalized = fileName.replace(/\\/g, '/');
    let base = path.basename(normalized).replace(/[\x00-\x1f\x7f\\/]/g, '_').trim();
    if (!base || base === '.' || base === '..') return 'download';
    return base.replace(/^\.+/, '') || 'download';
}

/**
 * Formats a standard RFC 5987 / RFC 6266 Content-Disposition attachment header.
 */
function getDispositionHeader(fileName) {
    const safeName = sanitizeFileName(fileName);
    const asciiFallback = safeName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    const utf8Encoded = encodeURIComponent(safeName);
    return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}

/**
 * Generates an inline presigned S3 URL suitable for viewing images, audio, and video in the browser.
 */
async function getMediaUrl(mediaObj) {
    if (mediaObj && typeof mediaObj === 'object' && mediaObj.provider === 's3') {
        if (!mediaObj.key || typeof mediaObj.key !== 'string' || mediaObj.key.includes('..')) {
            return '';
        }
        try {
            return await getSignedUrl(s3Client, new GetObjectCommand({
                Bucket: process.env.AWS_S3_BUCKET || 'default-bucket',
                Key: mediaObj.key
            }), { expiresIn: 3600 });
        } catch (e) {
            return '';
        }
    }
    return mediaObj || '';
}

/**
 * Generates a presigned S3 URL with ResponseContentDisposition set to attachment,
 * prompting the browser to download the file directly using its original filename and extension.
 */
async function getDownloadUrl(mediaObj, originalFileName) {
    let key = '';
    let fileName = originalFileName;
    let mimeType = '';

    if (mediaObj && typeof mediaObj === 'object') {
        if (mediaObj.provider === 's3' || mediaObj.key) {
            key = mediaObj.key;
        } else if (mediaObj.path && typeof mediaObj.path === 'object' && (mediaObj.path.provider === 's3' || mediaObj.path.key)) {
            key = mediaObj.path.key;
            if (!fileName) fileName = mediaObj.path.fileName || mediaObj.name;
            if (!mimeType) mimeType = mediaObj.path.mimeType || mediaObj.type;
        } else if (mediaObj.url && typeof mediaObj.url === 'object' && (mediaObj.url.provider === 's3' || mediaObj.url.key)) {
            key = mediaObj.url.key;
            if (!fileName) fileName = mediaObj.url.fileName || mediaObj.name;
            if (!mimeType) mimeType = mediaObj.url.mimeType || mediaObj.type;
        }
        if (!fileName) fileName = mediaObj.fileName || mediaObj.name;
        if (!mimeType) mimeType = mediaObj.mimeType || mediaObj.type;
    } else if (typeof mediaObj === 'string' && mediaObj && !mediaObj.startsWith('http://') && !mediaObj.startsWith('https://') && !mediaObj.startsWith('data:')) {
        key = mediaObj;
    }

    if (!key) {
        return typeof mediaObj === 'string' ? mediaObj : '';
    }
    if (typeof key !== 'string' || key.includes('..')) {
        return '';
    }

    if (!fileName) {
        const rawBase = path.basename(key);
        fileName = rawBase.replace(/^\d{10,14}-/, '') || rawBase || 'download';
    }

    try {
        const disposition = getDispositionHeader(fileName);
        const commandParams = {
            Bucket: process.env.AWS_S3_BUCKET || 'default-bucket',
            Key: key,
            ResponseContentDisposition: disposition
        };
        if (mimeType) {
            commandParams.ResponseContentType = mimeType;
        }
        return await getSignedUrl(s3Client, new GetObjectCommand(commandParams), { expiresIn: 3600 });
    } catch (e) {
        console.error('Error generating S3 download presigned URL:', e.message);
        return '';
    }
}

module.exports = {
    createUploadMiddleware,
    handleUploadError,
    deleteS3Object,
    deleteS3Objects,
    extractS3Keys,
    filterUnreferencedS3Keys,
    getMediaUrl,
    getDownloadUrl
};
