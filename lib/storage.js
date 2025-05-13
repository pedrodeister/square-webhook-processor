/**
 * Storage utilities for webhook event processing
 * Uses Vercel KV for storing processed events and failed events
 */
const { kv } = require('@vercel/kv');

/**
 * Prefix constants for key organization
 */
const PREFIX = {
  EVENT: 'event:',
  FAILED: 'failed_events',
  METRICS: 'metrics:'
};

/**
 * Checks if an event has already been processed (idempotency check)
 * @param {string} eventId - The unique ID of the webhook event
 * @returns {Promise<boolean>} - True if the event has already been processed
 */
async function isDuplicateEvent(eventId) {
  if (!eventId) {
    console.error('No event ID provided for duplicate check');
    return false;
  }
  
  try {
    const exists = await kv.exists(`${PREFIX.EVENT}${eventId}`);
    return exists === 1;
  } catch (error) {
    console.error('Error checking for duplicate event:', error);
    // If we can't verify, assume it's not a duplicate
    // Better to process twice than to miss an event
    return false;
  }
}

/**
 * Logs a successfully processed event
 * @param {string} eventId - The unique ID of the webhook event
 * @param {Object} data - The event data
 * @returns {Promise<void>}
 */
async function logProcessedEvent(eventId, data) {
  if (!eventId) {
    console.error('No event ID provided for event logging');
    return;
  }
  
  try {
    // Store with basic metadata and 24-hour expiration (86400 seconds)
    await kv.set(`${PREFIX.EVENT}${eventId}`, JSON.stringify({
      processed_at: new Date().toISOString(),
      event_type: data.type || 'unknown',
      data: data
    }), { ex: 86400 });
    
    // Also increment the count for this event type for metrics
    const eventType = data.type || 'unknown';
    await kv.incr(`${PREFIX.METRICS}${eventType}`);
  } catch (error) {
    console.error('Error logging processed event:', error);
  }
}

/**
 * Stores a failed event for later retry
 * @param {Object} event - The webhook event that failed processing
 * @param {Error} error - The error that occurred
 * @returns {Promise<void>}
 */
async function storeFailedEvent(event, error) {
  if (!event || !event.event_id) {
    console.error('Invalid event provided for failure storage');
    return;
  }
  
  try {
    const failedEvent = {
      event_id: event.event_id,
      event_data: event,
      error: error.message,
      failed_at: new Date().toISOString(),
      retry_count: 0
    };
    
    // Add to sorted set with timestamp as score for ordered processing
    const score = Date.now();
    await kv.zadd(PREFIX.FAILED, { score, member: JSON.stringify(failedEvent) });
  } catch (storageError) {
    console.error('Error storing failed event:', storageError);
  }
}

/**
 * Retrieves all failed events for retry processing
 * @returns {Promise<Array>} - Array of failed events
 */
async function getFailedEvents() {
  try {
    return await kv.zrange(PREFIX.FAILED, 0, -1);
  } catch (error) {
    console.error('Error retrieving failed events:', error);
    return [];
  }
}

/**
 * Removes a failed event after successful retry
 * @param {string} eventJson - The JSON string of the event to remove
 * @returns {Promise<void>}
 */
async function removeFailedEvent(eventJson) {
  try {
    await kv.zrem(PREFIX.FAILED, eventJson);
  } catch (error) {
    console.error('Error removing failed event:', error);
  }
}

/**
 * Gets recent processed events for the dashboard
 * @param {number} limit - Maximum number of events to retrieve
 * @returns {Promise<Array>} - Array of recent events
 */
async function getRecentEvents(limit = 10) {
  try {
    const keys = await kv.keys(`${PREFIX.EVENT}*`, { limit });
    if (!keys.length) return [];
    
    const events = await kv.mget(...keys);
    return events.map((event, index) => {
      try {
        const parsed = JSON.parse(event);
        parsed.key = keys[index];
        return parsed;
      } catch (e) {
        return { key: keys[index], error: 'Failed to parse event data' };
      }
    });
  } catch (error) {
    console.error('Error retrieving recent events:', error);
    return [];
  }
}

module.exports = {
  isDuplicateEvent,
  logProcessedEvent,
  storeFailedEvent,
  getFailedEvents,
  removeFailedEvent,
  getRecentEvents
};
