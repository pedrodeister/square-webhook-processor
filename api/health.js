/**
 * Health check endpoint for monitoring system status
 */
const { kv } = require('@vercel/kv');
const { getSquareClient } = require('../lib/square-api');

/**
 * Health check handler function
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 */
export default async function handler(req, res) {
  const startTime = Date.now();
  const healthStatus = {
    status: 'ok',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      storage: { status: 'unknown' },
      squareApi: { status: 'unknown' }
    }
  };

  try {
    // Check KV storage connection
    try {
      await kv.ping();
      healthStatus.services.storage = {
        status: 'ok',
        latency: Date.now() - startTime
      };
    } catch (kvError) {
      healthStatus.services.storage = {
        status: 'error',
        message: kvError.message,
        latency: Date.now() - startTime
      };
      healthStatus.status = 'degraded';
    }

    // Check Square API connection
    if (process.env.SQUARE_ACCESS_TOKEN) {
      try {
        const squareClient = getSquareClient();
        const squareCheckStart = Date.now();
        // Just fetch a simple endpoint to verify connectivity
        await squareClient.locationsApi.listLocations();
        
        healthStatus.services.squareApi = {
          status: 'ok',
          latency: Date.now() - squareCheckStart
        };
      } catch (squareError) {
        healthStatus.services.squareApi = {
          status: 'error',
          message: squareError.message,
          latency: Date.now() - startTime
        };
        healthStatus.status = 'degraded';
      }
    } else {
      healthStatus.services.squareApi = {
        status: 'disabled',
        message: 'Square API is not configured'
      };
    }

    // Check environment variables
    const requiredEnvVars = ['SQUARE_SIGNATURE_KEY'];
    const missingVars = requiredEnvVars.filter(v => !process.env[v]);
    
    if (missingVars.length > 0) {
      healthStatus.status = 'degraded';
      healthStatus.missingEnvVars = missingVars;
    }

    // Check recent webhook activity
    try {
      const prefix = 'metrics:';
      const metricKeys = await kv.keys(`${prefix}*`);
      if (metricKeys.length > 0) {
        const metrics = {};
        for (const key of metricKeys) {
          const metricName = key.replace(prefix, '');
          metrics[metricName] = await kv.get(key);
        }
        healthStatus.webhookMetrics = metrics;
      }
    } catch (metricsError) {
      console.error('Error fetching metrics:', metricsError);
    }

    // Total response time
    healthStatus.responseTime = Date.now() - startTime;

    // Return appropriate status code
    const statusCode = healthStatus.status === 'ok' ? 200 : 
                       healthStatus.status === 'degraded' ? 207 : 500;
                       
    res.status(statusCode).json(healthStatus);
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
