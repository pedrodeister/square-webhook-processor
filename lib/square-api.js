/**
 * Square API integration for data enrichment
 */
const { Client, Environment } = require('square');

/**
 * Initialize the Square client with proper configuration and timeouts
 * @returns {Object} - Square API client instance
 */
function getSquareClient() {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('Square access token is not configured');
    throw new Error('Square API access token is not configured');
  }
  
  // Create Square client with timeout settings
  const client = new Client({
    accessToken: accessToken,
    environment: process.env.NODE_ENV === 'production' 
      ? Environment.Production 
      : Environment.Sandbox,
    userAgentDetail: 'Square-Webhook-Handler',
    timeout: 10000 // 10 second timeout for all requests
  });
  
  // Log initialization
  console.log(JSON.stringify({
    level: 'info',
    event: 'square_client_initialized',
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
    timestamp: new Date().toISOString()
  }));
  
  return client;
}

/**
 * Enriches order data with full order details and customer information
 * @param {string} orderId - The Square order ID
 * @param {string} locationId - The Square location ID
 * @returns {Promise<Object>} - Enriched order and customer data
 */
async function enrichOrderData(orderId, locationId) {
  if (!orderId) {
    console.error('Order ID is required for data enrichment');
    return null;
  }
  
  try {
    const squareClient = getSquareClient();
    
    // Retrieve detailed order information
    const { result } = await squareClient.ordersApi.retrieveOrder(orderId);
    const { order } = result;
    
    // Get customer data if available
    let customer = null;
    if (order.customer_id) {
      try {
        const { result: customerResult } = await squareClient.customersApi.retrieveCustomer(order.customer_id);
        customer = customerResult.customer;
      } catch (customerError) {
        console.error('Error retrieving customer data:', customerError);
        // Continue with order data even if customer data fails
      }
    }
    
    return {
      order: order,
      customer: customer
    };
  } catch (error) {
    console.error('Error enriching order data:', error);
    return null;
  }
}

/**
 * Retrieves payment details for a payment
 * @param {string} paymentId - The Square payment ID
 * @returns {Promise<Object>} - Payment details
 */
async function getPaymentDetails(paymentId) {
  if (!paymentId) {
    console.error('Payment ID is required');
    return null;
  }
  
  try {
    const squareClient = getSquareClient();
    const { result } = await squareClient.paymentsApi.getPayment(paymentId);
    return result.payment;
  } catch (error) {
    console.error('Error retrieving payment details:', error);
    return null;
  }
}

/**
 * Retrieves item catalog information
 * @param {Array<string>} itemVariationIds - Array of item variation IDs
 * @returns {Promise<Object>} - Catalog items information
 */
async function getCatalogItems(itemVariationIds) {
  if (!itemVariationIds || !itemVariationIds.length) {
    return null;
  }
  
  try {
    const squareClient = getSquareClient();
    const { result } = await squareClient.catalogApi.batchRetrieveCatalogObjects({
      objectIds: itemVariationIds,
      includeRelatedObjects: true
    });
    
    return result;
  } catch (error) {
    console.error('Error retrieving catalog items:', error);
    return null;
  }
}

/**
 * Create a timeout promise for API calls
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operationName - Name of the operation for error message
 * @returns {Promise} - A promise that rejects after the timeout
 */
function createTimeout(timeoutMs, operationName) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Timeout: ${operationName} operation took longer than ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

/**
 * Process webhook event and enrich with additional data
 * @param {Object} webhookData - The raw webhook data
 * @returns {Promise<Object>} - Enriched event data
 */
async function enrichWebhookData(webhookData) {
  if (!webhookData || !webhookData.type) {
    console.error('Invalid webhook data for enrichment');
    return webhookData;
  }
  
  const eventType = webhookData.type;
  const data = webhookData.data?.object;
  const eventId = webhookData.event_id || 'unknown';
  
  // Skip enrichment for non-object events or if data is missing
  if (!data) {
    return webhookData;
  }
  
  try {
    // Log enrichment start
    console.log(JSON.stringify({
      level: 'info',
      event: 'webhook_enrichment_start',
      event_id: eventId,
      event_type: eventType,
      timestamp: new Date().toISOString()
    }));
    
    let enrichedData = { ...webhookData };
    const enrichmentTimeout = 7000; // 7 seconds for enrichment operations
    
    // Enrich based on event type
    switch (eventType) {
      case 'order.created':
      case 'order.updated':
      case 'order.fulfilled':
        if (data.id && data.location_id) {
          // Use Promise.race to implement timeout
          const enrichOrderPromise = enrichOrderData(data.id, data.location_id);
          const timeoutPromise = createTimeout(enrichmentTimeout, 'Order enrichment');
          
          try {
            enrichedData.enriched = await Promise.race([
              enrichOrderPromise,
              timeoutPromise
            ]);
          } catch (timeoutError) {
            console.warn(`Order enrichment timed out for order ${data.id}: ${timeoutError.message}`);
            // Continue without enrichment data
          }
        }
        break;
        
      case 'payment.created':
      case 'payment.updated':
        if (data.id) {
          try {
            // Get payment details with timeout
            const paymentPromise = getPaymentDetails(data.id);
            const paymentTimeoutPromise = createTimeout(enrichmentTimeout, 'Payment details');
            
            const payment = await Promise.race([
              paymentPromise,
              paymentTimeoutPromise
            ]);
            
            enrichedData.enriched = { payment };
            
            // If payment has order ID, get order data too (with separate timeout)
            if (payment?.order_id) {
              const orderId = payment.order_id;
              const locationId = payment.location_id;
              
              try {
                const orderPromise = enrichOrderData(orderId, locationId);
                const orderTimeoutPromise = createTimeout(enrichmentTimeout, 'Order data for payment');
                
                const orderData = await Promise.race([
                  orderPromise,
                  orderTimeoutPromise
                ]);
                
                enrichedData.enriched.order = orderData;
              } catch (orderTimeoutError) {
                console.warn(`Order data enrichment timed out for payment ${data.id}: ${orderTimeoutError.message}`);
                // Continue without order enrichment
              }
            }
          } catch (paymentTimeoutError) {
            console.warn(`Payment enrichment timed out for payment ${data.id}: ${paymentTimeoutError.message}`);
            // Continue without payment enrichment
          }
        }
        break;
        
      // Add more event types as needed
      default:
        // No enrichment for other event types
        break;
    }
    
    // Log enrichment completion
    console.log(JSON.stringify({
      level: 'info',
      event: 'webhook_enrichment_complete',
      event_id: eventId,
      event_type: eventType,
      enriched: !!enrichedData.enriched,
      timestamp: new Date().toISOString()
    }));
    
    return enrichedData;
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'webhook_enrichment_failed',
      event_id: eventId,
      event_type: eventType,
      error: error.message,
      timestamp: new Date().toISOString()
    }));
    
    // Return original data if enrichment fails
    return webhookData;
  }
}

module.exports = {
  getSquareClient,
  enrichOrderData,
  getPaymentDetails,
  getCatalogItems,
  enrichWebhookData
};
