/**
 * Square Webhook Processing Hub
 * Main handler for Square webhook events
 */
const { validateSignature } = require('../lib/signature');
const { isDuplicateEvent, logProcessedEvent, storeFailedEvent } = require('../lib/storage');
const { enrichWebhookData } = require('../lib/square-api');
const { sendToServerGTM, sendToCRM, sendHighValueOrderAlert, logToAnalyticsDashboard } = require('../lib/gtm-api');

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
  try {
    // Skip if no data or event ID
    if (!webhookData || !webhookData.event_id) {
      console.error('Invalid webhook data received');
      return;
    }

    const eventId = webhookData.event_id;
    const eventType = webhookData.type;

    console.log(`Processing ${eventType} event: ${eventId}`);
    
    // 1. Check for duplicate events (idempotency)
    if (await isDuplicateEvent(eventId)) {
      console.log(`Skipping duplicate event: ${eventId}`);
      return;
    }
    
    // 2. Enrich data with Square API
    let enrichedData = null;
    try {
      enrichedData = await enrichWebhookData(webhookData);
    } catch (enrichError) {
      console.warn('Error enriching webhook data:', enrichError.message);
      // Continue with processing even if enrichment fails
    }
    
    // 3. Distribute event to configured destinations
    await distributeEvent(webhookData, enrichedData);
    
    // 4. Log successful processing
    await logProcessedEvent(eventId, webhookData);
    
    console.log(`Successfully processed event: ${eventId}`);
  } catch (error) {
    console.error('Error processing webhook event:', error);
    // Store failed event for retry
    await storeFailedEvent(webhookData, error);
  }
}

/**
 * Distribute webhook event to configured destinations
 * @param {Object} webhookData - The webhook data
 * @param {Object} enrichedData - Enriched data from Square API
 * @returns {Promise<void>}
 */
async function distributeEvent(webhookData, enrichedData) {
  const eventDistributionPromises = [];
  
  // Send to Server GTM for GA4
  if (process.env.GTM_SERVER_URL) {
    eventDistributionPromises.push(
      sendToServerGTM(webhookData, enrichedData)
        .catch(error => console.error('GTM distribution failed:', error.message))
    );
  }
  
  // Send to CRM (if configured)
  if (process.env.CRM_WEBHOOK_URL) {
    eventDistributionPromises.push(
      sendToCRM(webhookData, enrichedData)
        .catch(error => console.error('CRM distribution failed:', error.message))
    );
  }
  
  // Send high-value order alerts
  const orderValue = getOrderValue(webhookData);
  const highValueThreshold = Number(process.env.HIGH_VALUE_THRESHOLD) || 100;
  
  if (orderValue > highValueThreshold && process.env.NOTIFICATION_WEBHOOK_URL) {
    eventDistributionPromises.push(
      sendHighValueOrderAlert(webhookData, enrichedData)
        .catch(error => console.error('High-value alert failed:', error.message))
    );
  }
  
  // Log to analytics dashboard
  eventDistributionPromises.push(
    logToAnalyticsDashboard(webhookData)
      .catch(error => console.error('Analytics logging failed:', error.message))
  );
  
  // Wait for all distribution to complete
  await Promise.allSettled(eventDistributionPromises);
}

/**
 * Main webhook handler function
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 */
export default async function handler(req, res) {
  // Only allow POST method
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Respond to Square quickly (within 3 seconds)
  // Square requires a 200 response within 3 seconds to consider the webhook delivered
  res.status(200).send('OK');
  
  try {
    // Log request details for debugging
    console.log('Received webhook:', {
      eventType: req.body?.type,
      eventId: req.body?.event_id,
      timestamp: new Date().toISOString()
    });
    
    // 1. Validate signature
    const signature = req.headers['x-square-hmacsha256-signature'];
    const payload = JSON.stringify(req.body);
    const signatureKey = process.env.SQUARE_SIGNATURE_KEY;
    
    if (!signatureKey) {
      console.error('Missing SQUARE_SIGNATURE_KEY in environment variables');
      return;
    }
    
    const isValid = validateSignature(payload, signature, signatureKey);
    if (!isValid) {
      console.error('Invalid webhook signature');
      return;
    }
    
    // 2. Process webhook data asynchronously
    // We already responded to Square, so we can take our time with processing
    await processWebhookEvent(req.body);
    
  } catch (error) {
    console.error('Error in webhook handler:', error);
  }
}
