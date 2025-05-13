/**
 * Square API integration for data enrichment
 */
const { Client, Environment } = require('square');

/**
 * Initialize the Square client with proper configuration
 * @returns {Object} - Square API client instance
 */
function getSquareClient() {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('Square access token is not configured');
    throw new Error('Square API access token is not configured');
  }
  
  return new Client({
    accessToken: accessToken,
    environment: process.env.NODE_ENV === 'production' 
      ? Environment.Production 
      : Environment.Sandbox,
    userAgentDetail: 'Square-Webhook-Handler'
  });
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
  
  // Skip enrichment for non-object events or if data is missing
  if (!data) {
    return webhookData;
  }
  
  try {
    let enrichedData = { ...webhookData };
    
    // Enrich based on event type
    switch (eventType) {
      case 'order.created':
      case 'order.updated':
      case 'order.fulfilled':
        if (data.id && data.location_id) {
          enrichedData.enriched = await enrichOrderData(data.id, data.location_id);
        }
        break;
        
      case 'payment.created':
      case 'payment.updated':
        if (data.id) {
          enrichedData.enriched = {
            payment: await getPaymentDetails(data.id)
          };
          
          // If payment has order ID, get order data too
          if (enrichedData.enriched.payment?.order_id) {
            const orderId = enrichedData.enriched.payment.order_id;
            const locationId = enrichedData.enriched.payment.location_id;
            enrichedData.enriched.order = await enrichOrderData(orderId, locationId);
          }
        }
        break;
        
      // Add more event types as needed
      default:
        // No enrichment for other event types
        break;
    }
    
    return enrichedData;
  } catch (error) {
    console.error('Error during webhook data enrichment:', error);
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
