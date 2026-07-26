const promClient = require('prom-client');

// Enable default Node.js runtime metrics (CPU, Memory, etc.)
promClient.collectDefaultMetrics();

// Define metrics
const httpRequestDurationMicroseconds = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
});

const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'code']
});

const httpErrorsTotal = new promClient.Counter({
  name: 'http_errors_total',
  help: 'Total number of HTTP errors',
  labelNames: ['method', 'route', 'code']
});

// Middleware to record metrics
const metricsMiddleware = (req, res, next) => {
  const end = httpRequestDurationMicroseconds.startTimer();
  res.on('finish', () => {
    const route = req.route ? req.route.path : req.path;
    const code = res.statusCode;
    const method = req.method;

    // Record duration
    end({ route, code, method });
    
    // Record total requests
    httpRequestsTotal.inc({ route, code, method });
    
    // Record errors (4xx / 5xx)
    if (code >= 400) {
      httpErrorsTotal.inc({ route, code, method });
    }
  });
  next();
};

// Endpoint to expose metrics
const metricsEndpoint = async (req, res) => {
  try {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
  } catch (ex) {
    res.status(500).end(ex);
  }
};

module.exports = {
  metricsMiddleware,
  metricsEndpoint
};
