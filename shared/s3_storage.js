const path = require("path");
const { Upload } = require("@aws-sdk/lib-storage");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });

function S3Storage(opts) {
    this.bucket = opts.bucket;
    this.prefix = opts.prefix || '';
}

S3Storage.prototype._handleFile = function _handleFile(req, file, cb) {
    const key = this.prefix + Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    const upload = new Upload({
        client: s3Client,
        params: {
            Bucket: this.bucket,
            Key: key,
            Body: file.stream,
            ContentType: file.mimetype
        }
    });

    upload.done()
        .then(data => {
            cb(null, {
                provider: 's3',
                key: key,
                mimeType: file.mimetype,
                fileName: file.originalname,
                size: req.headers['content-length'] ? parseInt(req.headers['content-length'], 10) : 0
            });
        })
        .catch(err => cb(err));
};

S3Storage.prototype._removeFile = function _removeFile(req, file, cb) {
    cb(null);
};

/**
 * Sanitizes a filename to protect against path traversal and header injection.
 */
function sanitizeFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') return 'download';
    const normalized = fileName.replace(/\\/g, '/');
    const base = path.basename(normalized).replace(/[\x00-\x1f\x7f\\/]/g, '_').trim();
    return base || 'download';
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
    S3Storage,
    getMediaUrl,
    getDownloadUrl,
    sanitizeFileName,
    getDispositionHeader
};
