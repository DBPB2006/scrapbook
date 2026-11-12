/**
 * Scrapbook - Centralized Frontend Configuration
 * Manages API Base URL, LocationIQ browser key, JWT Bearer authentication, media resolution, and third-party API configs.
 *
 * In AWS production deployments, Jenkins populates the deployed API_BASE_URL and
 * LOCATIONIQ_API_KEY values directly into config.js before syncing client/ to S3.
 * Restrict the replacement LOCATIONIQ_API_KEY via HTTP Referrer rules in the
 * LocationIQ dashboard (never commit real keys or backend secrets to Git).
 */
(function () {
    const DEPLOYED_API_BASE_URL = '<ALB_API_URL>';
    const DEPLOYED_LOCATIONIQ_API_KEY = '<LOCATIONIQ_API_KEY>';

    function resolveConfiguredValue(deployedValue, windowFallback) {
        if (typeof deployedValue === 'string') {
            const trimmed = deployedValue.trim();
            if (trimmed && !/^<[^>]+>$/.test(trimmed)) {
                return trimmed;
            }
        }
        if (typeof windowFallback === 'string') {
            const trimmedFallback = windowFallback.trim();
            if (trimmedFallback && !/^<[^>]+>$/.test(trimmedFallback)) {
                return trimmedFallback;
            }
        }
        return '';
    }

    // Auto-detect local development environments (e.g. Docker Compose port 8080 or Live Server port 5500)
    let defaultLocalBaseUrl = '';
    if (typeof window !== 'undefined' && window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        if (window.location.port && window.location.port !== '3090') {
            defaultLocalBaseUrl = `${window.location.protocol || 'http:'}//${window.location.hostname}:3090`;
        }
    }

    const configuredBaseUrl = resolveConfiguredValue(
        DEPLOYED_API_BASE_URL,
        typeof window !== 'undefined' ? window.API_BASE_URL : ''
    ) || defaultLocalBaseUrl;
    const API_BASE_URL = configuredBaseUrl.replace(/\/+$/, '');

    // Required LocationIQ public browser key for location autocomplete and geocoding (HTTP referrer-restricted)
    const LOCATIONIQ_API_KEY = resolveConfiguredValue(
        DEPLOYED_LOCATIONIQ_API_KEY,
        typeof window !== 'undefined' ? window.LOCATIONIQ_API_KEY : ''
    );

    /**
     * Sanitizes a URL to block dangerous scriptable schemes (javascript:, vbscript:, data:text/html, SVG data URIs).
     * Allows relative paths, http:, https:, blob:, and safe image/audio/video/pdf data URIs.
     */
    function sanitizeUrl(url) {
        if (!url) return '';
        if (typeof url === 'object') {
            url = url.url || url.preview_url || url.path || '';
        }
        if (typeof url !== 'string') return '';
        // Strip control characters and leading/trailing whitespace before inspecting scheme
        const trimmed = url.replace(/[\u0000-\u001F\u007F]/g, '').trim();
        if (!trimmed) return '';

        const colonIdx = trimmed.indexOf(':');
        const slashIdx = trimmed.indexOf('/');
        const qIdx = trimmed.indexOf('?');
        const hIdx = trimmed.indexOf('#');
        const firstDelim = [slashIdx, qIdx, hIdx].filter(i => i >= 0).reduce((a, b) => Math.min(a, b), Infinity);

        // If a URI scheme is present before any path/query/hash delimiter
        if (colonIdx > 0 && colonIdx < firstDelim) {
            const scheme = trimmed.slice(0, colonIdx).toLowerCase();
            if (scheme === 'http' || scheme === 'https' || scheme === 'blob') {
                return trimmed;
            }
            if (scheme === 'data') {
                // Allow only safe non-scriptable media data URIs (explicitly block data:text/html and data:image/svg+xml)
                if (/^data:(?:image\/(?:png|jpe?g|gif|webp|bmp)|audio\/(?:mpeg|mp3|wav|ogg|webm|mp4|aac)|video\/(?:mp4|webm|ogg|quicktime)|application\/pdf)\b/i.test(trimmed)) {
                    return trimmed;
                }
                return '';
            }
            return '';
        }

        // Reject protocol-relative redirects (//evil.com) and backslash tricks
        if (trimmed.startsWith('//') || trimmed.startsWith('\\\\')) return '';
        return trimmed;
    }

    /**
     * Safely renders plain text with line breaks using Text nodes and <br> elements (no innerHTML).
     * Pass { append: true } to preserve existing child elements before appending text.
     */
    function setTextWithBreaks(element, text, options) {
        if (!element) return;
        if (!options || !options.append) {
            while (element.firstChild) {
                element.removeChild(element.firstChild);
            }
        }
        const value = text == null ? '' : String(text);
        const lines = value.split(/\r\n|\r|\n/);
        lines.forEach((line, idx) => {
            if (idx > 0) {
                element.appendChild(document.createElement('br'));
            }
            element.appendChild(document.createTextNode(line));
        });
    }

    /**
     * Resolves a media file path or presigned S3 URL to a fully qualified safe URL.
     * - Returns empty string for null/undefined/empty/unsafe input safely.
     * - Preserves already absolute URLs (http, https, blob, safe data:, //) and S3 presigned URLs.
     * - Resolves relative paths against the configured API_BASE_URL (or root relative).
     */
    function resolveMediaUrl(url) {
        const sanitized = sanitizeUrl(url);
        if (!sanitized) return '';

        // Preserve already absolute safe URLs
        if (/^(https?:|blob:|\/\/|data:)/i.test(sanitized)) {
            return sanitized;
        }

        // Relative path resolution
        const cleanPath = sanitized.startsWith('/') ? sanitized : '/' + sanitized;
        return API_BASE_URL ? `${API_BASE_URL}${cleanPath}` : cleanPath;
    }

    /**
     * Helper to extract a clean lowercase file extension stripped of query strings and hashes.
     */
    function getCleanExtension(url) {
        if (!url || typeof url !== 'string') return '';
        try {
            const clean = url.split('?')[0].split('#')[0];
            return clean.split('.').pop().toLowerCase();
        } catch (e) {
            return '';
        }
    }

    function parseUtcDate(raw) {
        if (!raw) return null;
        if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
        const str = String(raw).trim();
        if (!str) return null;
        const iso = str.replace(' ', 'T');
        const withTz = /(Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`;
        const parsed = new Date(withTz);
        if (!isNaN(parsed.getTime())) return parsed;
        const fallback = new Date(str);
        return isNaN(fallback.getTime()) ? null : fallback;
    }

    function formatLocalDateTime(raw) {
        const d = parseUtcDate(raw);
        if (!d) return raw ? String(raw) : '-';
        const pad = (n) => n.toString().padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    // Single unified global configuration object
    window.ScrapbookConfig = {
        API_BASE_URL: API_BASE_URL,
        LOCATIONIQ_API_KEY: LOCATIONIQ_API_KEY,
        sanitizeUrl: sanitizeUrl,
        setTextWithBreaks: setTextWithBreaks,
        resolveMediaUrl: resolveMediaUrl,
        getCleanExtension: getCleanExtension,
        parseUtcDate: parseUtcDate,
        formatLocalDateTime: formatLocalDateTime
    };

    // Configure Axios defaults and interceptors if Axios is loaded
    if (typeof axios !== 'undefined') {
        if (API_BASE_URL) {
            axios.defaults.baseURL = API_BASE_URL;
        }

        // Request Interceptor: Attach JWT Bearer token only to internal backend requests
        axios.interceptors.request.use(
            function (config) {
                const token = sessionStorage.getItem('scrapbook_access_token');
                if (token) {
                    const url = config.url || '';
                    // Never send JWT to external APIs, S3 presigned URLs, or unrelated domains
                    const isExternal = /^https?:\/\//i.test(url) && (!API_BASE_URL || !url.startsWith(API_BASE_URL));
                    if (!isExternal) {
                        config.headers = config.headers || {};
                        config.headers['Authorization'] = 'Bearer ' + token;
                    }
                }
                return config;
            },
            function (error) {
                return Promise.reject(error);
            }
        );

        // Response Interceptor: Maintain token state and handle 401 unauthorized
        axios.interceptors.response.use(
            function (response) {
                if (response.data && response.data.token) {
                    sessionStorage.setItem('scrapbook_access_token', response.data.token);
                }
                return response;
            },
            function (error) {
                if (error.response && error.response.status === 401) {
                    const path = window.location.pathname.toLowerCase();
                    const isPublic = path.endsWith('/login.html') || path.endsWith('/signup.html') || path.endsWith('/index.html') || path === '/' || path === '';
                    if (!isPublic) {
                        sessionStorage.removeItem('scrapbook_access_token');
                        window.location.href = '/login.html';
                    }
                }
                return Promise.reject(error);
            }
        );
    }
})();
