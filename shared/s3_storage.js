const { Upload } = require("@aws-sdk/lib-storage");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

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

async function getMediaUrl(mediaObj) {
    if (mediaObj && typeof mediaObj === 'object' && mediaObj.provider === 's3') {
        try {
            return await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET || 'default-bucket', Key: mediaObj.key }), { expiresIn: 3600 });
        } catch(e) { return ''; }
    }
    return mediaObj || '';
}

module.exports = {
    S3Storage,
    getMediaUrl
};
