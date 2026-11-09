/**
 * Memory Book - Runtime Environment Configuration
 *
 * In AWS production deployments (S3 static website hosting), Jenkins generates
 * and uploads this file with the active Application Load Balancer endpoint:
 *
 *   window.__MEMORYBOOK_CONFIG__ = {
 *       API_BASE_URL: 'http://<alb-dns-name>'
 *   };
 *
 * In local development, leaving API_BASE_URL unset allows config.js to
 * automatically fall back to the local API Gateway URL.
 */
window.__MEMORYBOOK_CONFIG__ = window.__MEMORYBOOK_CONFIG__ || {};

