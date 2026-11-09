/**
 * Memory Book - Centralized Frontend Configuration
 * Manages API Base URL, JWT Bearer authentication, media resolution, and third-party API configs.
 */
(function () {
    // Read dynamic API_BASE_URL from deployment runtime injection or global window
    const runtimeConfig = (typeof window !== 'undefined' && window.__MEMORYBOOK_CONFIG__) || {};

    // Auto-detect local development environments (e.g. Docker Compose port 8080 or Live Server port 5500)
    let defaultLocalBaseUrl = '';
    if (typeof window !== 'undefined' && window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        if (window.location.port && window.location.port !== '3090') {
            defaultLocalBaseUrl = `${window.location.protocol || 'http:'}//${window.location.hostname}:3090`;
        }
    }

    const configuredBaseUrl = (typeof runtimeConfig.API_BASE_URL === 'string' && runtimeConfig.API_BASE_URL.trim())
        || (typeof window !== 'undefined' && typeof window.API_BASE_URL === 'string' && window.API_BASE_URL.trim())
        || defaultLocalBaseUrl;
    const API_BASE_URL = configuredBaseUrl.replace(/\/+$/, '');

    // Centralized LocationIQ configuration (Synopsis §4.3)
    const LOCATIONIQ_API_KEY = runtimeConfig.LOCATIONIQ_API_KEY || 'pk.235663a366caa807557a9a233647f569';

    /**
     * Resolves a media file path or presigned S3 URL to a fully qualified URL.
     * - Returns empty string for null/undefined/empty input safely.
     * - Preserves already absolute URLs (http, https, data:, //) and S3 presigned URLs untouched.
     * - Resolves relative paths against the configured API_BASE_URL (or root relative).
     */
    function resolveMediaUrl(url) {
        if (!url) return '';
        if (typeof url === 'object') {
            url = url.url || url.preview_url || url.path || '';
        }
        if (typeof url !== 'string') return '';
        const trimmed = url.trim();
        if (!trimmed) return '';

        // Preserve already absolute URLs (including http, https, protocol-relative //, and data: URIs)
        if (/^(https?:|\/\/|data:)/i.test(trimmed)) {
            return trimmed;
        }

        // Relative path resolution
        const cleanPath = trimmed.startsWith('/') ? trimmed : '/' + trimmed;
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

    // Single unified global configuration object
    window.MemoryBookConfig = {
        API_BASE_URL: API_BASE_URL,
        LOCATIONIQ_API_KEY: LOCATIONIQ_API_KEY,
        resolveMediaUrl: resolveMediaUrl,
        getCleanExtension: getCleanExtension
    };

    // Backward-compatibility aliases for legacy code
    window.MEMORYBOOK_CONFIG = window.MemoryBookConfig;
    window.resolveMediaUrl = resolveMediaUrl;

    // Configure Axios defaults and interceptors if Axios is loaded
    if (typeof axios !== 'undefined') {
        if (API_BASE_URL) {
            axios.defaults.baseURL = API_BASE_URL;
        }

        // Request Interceptor: Attach JWT Bearer token only to internal backend requests
        axios.interceptors.request.use(
            function (config) {
                const token = sessionStorage.getItem('mb_access_token');
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
                    sessionStorage.setItem('mb_access_token', response.data.token);
                }
                return response;
            },
            function (error) {
                if (error.response && error.response.status === 401) {
                    const path = window.location.pathname.toLowerCase();
                    const isPublic = path.endsWith('/login.html') || path.endsWith('/signup.html') || path.endsWith('/index.html') || path === '/' || path === '';
                    if (!isPublic) {
                        sessionStorage.removeItem('mb_access_token');
                        window.location.href = '/login.html';
                    }
                }
                return Promise.reject(error);
            }
        );
    }
})();
