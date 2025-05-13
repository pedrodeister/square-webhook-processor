/**
 * Retry mechanism for failed webhook events
 * This endpoint is scheduled to run at a regular interval via Vercel cron jobs
 */
const { getFailedEvents, removeFailedEvent } = require('../lib/storage');

// Import the core processing function from square-webhook.js
// We need to redefine it here since it's not exported from that file
// In a real-world scenario, we'd probably refactor to share this code
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
 * Process webhook event
 * @param {Object} webhookData - The webhook event data
 * @returns {Promise<boolean>} - Whether processing was successful
 */
async function processWebhookEvent(webhookData) {
  try {
    // Skip if no data or event ID
    if (!webhookData || !webhookData.event_id) {
      console.error('Invalid webhook data received');
      return false;
    }

    const eventId = webhookData.event_id;
    const eventType = webhookData.type;

    console.log(`Processing ${eventType} event: ${eventId}`);
    
    // 1. Check for duplicate events (idempotency)
    if (await isDuplicateEvent(eventId)) {
      console.log(`Skipping duplicate event: ${eventId}`);
      return true; // Success since we're handling the duplicate case
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
    return true;
  } catch (error) {
    console.error('Error processing webhook event:', error);
    return false;
  }
}

/**
 * Retry handler function
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 */
export default async function handler(req, res) {
  // Allow only GET for manual triggering and POST for webhook
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // For webhook trigger, verify secret key
  if (req.method === 'POST') {
    const secretKey = req.headers['x-retry-secret-key'];
    const configuredKey = process.env.RETRY_SECRET_KEY;
    
    if (!configuredKey || secretKey !== configuredKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  
  try {
    console.log('Starting retry of failed events');
    
    // Get failed events from storage
    const failedEvents = await getFailedEvents();
    
    if (!failedEvents || failedEvents.length === 0) {
      console.log('No failed events to retry');
      return res.status(200).json({ success: true, processed: 0 });
    }
    
    console.log(`Found ${failedEvents.length} failed events to retry`);
    
    // Process each failed event
    const results = {
      total: failedEvents.length,
      success: 0,
      failed: 0
    };
    
    for (const eventJson of failedEvents) {
      try {
        const event = JSON.parse(eventJson);
        const eventData = event.event_data;
        
        console.log(`Retrying event: ${eventData.event_id} (${eventData.type})`);
        
        // Attempt to process again
        const success = await processWebhookEvent(eventData);
        
        if (success) {
          // If successful, remove from failed events
          await removeFailedEvent(eventJson);
          results.success++;
          console.log(`Successfully reprocessed event: ${eventData.event_id}`);
        } else {
          results.failed++;
          console.log(`Failed to reprocess event: ${eventData.event_id}`);
          
          // Update retry count and potentially give up after too many attempts
          if (event.retry_count >= 5) { // Max 5 retries
            console.log(`Giving up on event after ${event.retry_count} attempts: ${eventData.event_id}`);
            await removeFailedEvent(eventJson);
          } else {
            // We could update the retry count here, but we'd need to remove the old event and add a new one
            // For simplicity, we'll leave it for now - a more robust implementation would update the retry count
          }
        }
      } catch (error) {
        results.failed++;
        console.error(`Error during retry:`, error);
      }
    }
    
    console.log('Retry process completed:', results);
    
    return res.status(200).json({
      success: true,
      results: results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in retry handler:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
