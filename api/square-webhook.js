/**
 * Square Webhook Processing Hub
 * Main handler for Square webhook events
 */
const { validateSignature } = require('../lib/signature');
const { isDuplicateEvent, checkAndMarkEventProcessed, logProcessedEvent, storeFailedEvent } = require('../lib/storage');
const { enrichWebhookData } = require('../lib/square-api');
const { sendToServerGTM, sendToCRM, sendHighValueOrderAlert, logToAnalyticsDashboard } = require('../lib/gtm-api');
const getRawBody = require('raw-body');

// Disable automatic body parsing for proper signature validation
export const config = {
  api: {
    bodyParser: false,
  },
};

// Define error classes for better error handling
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.permanent = true; // Will never succeed with retry
  }
}

class TransientError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransientError';
    this.retryable = true;
  }
}

// Validate environment variables at module load
const requiredEnvVars = ['SQUARE_SIGNATURE_KEY', 'SQUARE_ACCESS_TOKEN'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
  }
}

/**
 * Helper function to get order value
 * @param {Object} webhookData - The webhook data
 * @returns {number} - Order value in dollars/cents
 */
function getOrderValue(webhookData) {
  // For order events
  if (webhookData.type?.startsWith('order.') && webhookData.data?.object?.total_money?.amount) {
    return webhookData.data.object.total_money.amount / 100;
  }
  
  // For payment events
  if (webhookData.type?.startsWith('payment.') && webhookData.data?.object?.amount_money?.amount) {
    return webhookData.data.object.amount_money.amount / 100;
  }
  
  return 0;
}

/**
 * Process webhook event and distribute to destinations
 * @param {Object} webhookData - The webhook event data
 * @returns {Promise<void>}
 */
async function processWebhookEvent(webhookData) {
  const startTime = Date.now();
  
  try {
    // Skip if no data or event ID
    if (!webhookData || !webhookData.event_id) {
      throw new ValidationError('Invalid webhook data received - missing event_id');
    }

    const eventId = webhookData.event_id;
    const eventType = webhookData.type || 'unknown';

    // Log structured processing start
    console.log(JSON.stringify({
      level: 'info',
      event: 'webhook_processing_start',
      event_id: eventId,
      event_type: eventType,
      timestamp: new Date().toISOString()
    }));
    
    // 1. Check for duplicate events and mark as processed in one atomic operation
    // This prevents race conditions where two instances process the same event
    const isNewEvent = await checkAndMarkEventProcessed(eventId, webhookData);
    
    if (!isNewEvent) {
      console.log(JSON.stringify({
        level: 'info',
        event: 'webhook_duplicate_skipped',
        event_id: eventId,
        event_type: eventType,
        timestamp: new Date().toISOString()
      }));
      return;
    }
    
    // 2. Enrich data with Square API (with timeout)
    let enrichedData = null;
    try {
      // Set a timeout for the enrichment process
      const enrichmentPromise = enrichWebhookData(webhookData);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new TransientError('Enrichment timed out')), 5000)
      );
      
      enrichedData = await Promise.race([enrichmentPromise, timeoutPromise]);
    } catch (enrichError) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'webhook_enrichment_failed',
        event_id: eventId,
        event_type: eventType,
        error: enrichError.message,
        timestamp: new Date().toISOString()
      }));
      // Continue with processing even if enrichment fails
    }
    
    // 3. Distribute event to configured destinations
    await distributeEvent(webhookData, enrichedData);
    
    // Calculate processing time
    const processingTime = Date.now() - startTime;
    
    // 4. Log successful processing
    console.log(JSON.stringify({
      level: 'info',
      event: 'webhook_processing_complete',
      event_id: eventId,
      event_type: eventType,
      processing_time_ms: processingTime,
      timestamp: new Date().toISOString()
    }));
    
  } catch (error) {
    // Calculate processing time even for errors
    const processingTime = Date.now() - startTime;
    
    // Log error with structured data
    console.error(JSON.stringify({
      level: 'error',
      event: 'webhook_processing_error',
      event_id: webhookData?.event_id || 'unknown',
      event_type: webhookData?.type || 'unknown',
      error: error.message,
      error_type: error.name,
      stack: error.stack,
      processing_time_ms: processingTime,
      timestamp: new Date().toISOString()
    }));
    
    // Classify errors for appropriate handling
    if (error.permanent) {
      // Permanent errors shouldn't be retried
      console.error('Permanent error - will not retry:', error.message);
    } else if (error.retryable || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      // Store for retry
      await storeFailedEvent(webhookData, {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        context: {
          eventId: webhookData?.event_id,
          eventType: webhookData?.type
        }
      });
    } else {
      // Unknown error type - store for analysis
      await storeFailedEvent(webhookData, error);
    }
  }
}

/**
 * Distribute webhook event to configured destinations
 * @param {Object} webhookData - The webhook data
 * @param {Object} enrichedData - Enriched data from Square API
 * @returns {Promise<void>}
 */
async function distributeEvent(webhookData, enrichedData) {
  const eventId = webhookData.event_id || 'unknown';
  const eventType = webhookData.type || 'unknown';
  const eventDistributionPromises = [];
  
  // Create a timeout wrapper for external calls
  const withTimeout = (promise, name, timeoutMs = 5000) => {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new TransientError(`${name} timed out after ${timeoutMs}ms`)), timeoutMs)
    );
    
    return Promise.race([
      promise,
      timeoutPromise
    ]).catch(error => {
      // Log detailed error information
      console.error(JSON.stringify({
        level: 'error',
        event: 'distribution_failed',
        distribution_target: name,
        event_id: eventId,
        event_type: eventType,
        error: error.message,
        error_type: error.name,
        timestamp: new Date().toISOString()
      }));
      
      // Re-throw to ensure Promise.allSettled catches it
      throw error;
    });
  };
  
  // Send to Server GTM for GA4
  if (process.env.GTM_SERVER_URL) {
    const gtmPromise = withTimeout(
      sendToServerGTM(webhookData, enrichedData),
      'GTM',
      8000 // GTM might need a bit more time
    );
    
    eventDistributionPromises.push(gtmPromise);
  }
  
  // Send to CRM (if configured)
  if (process.env.CRM_WEBHOOK_URL) {
    const crmPromise = withTimeout(
      sendToCRM(webhookData, enrichedData),
      'CRM'
    );
    
    eventDistributionPromises.push(crmPromise);
  }
  
  // Send high-value order alerts
  const orderValue = getOrderValue(webhookData);
  const highValueThreshold = Number(process.env.HIGH_VALUE_THRESHOLD) || 100;
  
  if (orderValue > highValueThreshold && process.env.NOTIFICATION_WEBHOOK_URL) {
    const notificationPromise = withTimeout(
      sendHighValueOrderAlert(webhookData, enrichedData),
      'Notification'
    );
    
    eventDistributionPromises.push(notificationPromise);
  }
  
  // Log to analytics dashboard (internal, so shorter timeout)
  const dashboardPromise = withTimeout(
    logToAnalyticsDashboard(webhookData),
    'Dashboard',
    3000
  );
  
  eventDistributionPromises.push(dashboardPromise);
  
  // Wait for all distribution to complete, regardless of success/failure
  const results = await Promise.allSettled(eventDistributionPromises);
  
  // Log distribution results summary
  const failedCount = results.filter(r => r.status === 'rejected').length;
  if (failedCount > 0) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'distribution_partial_failure',
      event_id: eventId,
      failed_count: failedCount,
      total_count: eventDistributionPromises.length,
      timestamp: new Date().toISOString()
    }));
  }
}

/**
 * Main webhook handler function
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 */
export default async function handler(req, res) {
  // Handle OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Square-HMACSHA256-Signature');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }
  
  // Only allow POST method
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // 1. Get raw body for signature validation
    const rawBody = await getRawBody(req, {
      length: req.headers['content-length'],
      limit: '1mb',
    });
    
    const bodyString = rawBody.toString('utf8');
    let webhookData;
    
    try {
      webhookData = JSON.parse(bodyString);
    } catch (parseError) {
      console.error('Invalid JSON in webhook payload');
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    
    // Log structured request details for debugging
    console.log(JSON.stringify({
      level: 'info',
      event: 'webhook_received',
      event_type: webhookData?.type,
      event_id: webhookData?.event_id,
      timestamp: new Date().toISOString()
    }));
    
    // 2. Validate signature before responding
    const signature = req.headers['x-square-hmacsha256-signature'];
    const signatureKey = process.env.SQUARE_SIGNATURE_KEY;
    
    if (!signatureKey) {
      console.error('Missing SQUARE_SIGNATURE_KEY in environment variables');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
    // Allow max 2 seconds for signature validation to still respond quickly to Square
    const isValid = validateSignature(bodyString, signature, signatureKey);
    if (!isValid) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // 3. Respond to Square quickly (within 3 seconds)
    // Only after validation is successful
    res.status(200).send('OK');
    
    // 4. Process webhook data asynchronously
    // We've already responded to Square, so we can take our time with processing
    processWebhookEvent(webhookData).catch(error => {
      console.error('Unhandled error in processWebhookEvent:', error);
    });
    
  } catch (error) {
    console.error('Error in webhook handler:', error);
    
    // If we haven't responded yet, send an error response
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}
