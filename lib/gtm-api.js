/**
 * Google Tag Manager server-side integration
 */
const axios = require('axios');

/**
 * Transform webhook data into GA4-compatible format
 * @param {Object} webhookData - The raw or enriched webhook data
 * @returns {Object} - GA4-formatted event data
 */
function transformForGA4(webhookData) {
  if (!webhookData || !webhookData.type) {
    console.error('Invalid webhook data for GA4 transformation');
    return null;
  }
  
  // Base event data structure
  const ga4Event = {
    client_id: `square_${webhookData.merchant_id || 'unknown'}`,
    timestamp_micros: Date.now() * 1000,
    non_personalized_ads: true,
    events: [
      {
        name: mapEventName(webhookData.type),
        params: {
          engagement_time_msec: 1,
          session_id: webhookData.event_id || `${Date.now()}`,
          event_source: 'square_webhook',
          webhook_event_type: webhookData.type
        }
      }
    ]
  };

  // Extract event-specific data
  const eventData = webhookData.data?.object;
  if (eventData) {
    addEventParams(ga4Event.events[0].params, webhookData.type, eventData, webhookData.enriched);
  }
  
  return ga4Event;
}

/**
 * Maps Square webhook event types to GA4 event names
 * @param {string} squareEventType - The Square event type
 * @returns {string} - GA4 event name
 */
function mapEventName(squareEventType) {
  // Map Square event types to GA4-compatible event names
  const eventMap = {
    'order.created': 'purchase',
    'order.updated': 'order_updated',
    'order.fulfilled': 'order_fulfilled',
    'payment.created': 'payment_received',
    'payment.updated': 'payment_updated',
    'refund.created': 'refund',
    'customer.created': 'new_customer',
    'customer.updated': 'customer_updated',
    'inventory.count.updated': 'inventory_updated'
    // Add more mappings as needed
  };
  
  return eventMap[squareEventType] || 'square_webhook_event';
}

/**
 * Add event-specific parameters to the GA4 event object
 * @param {Object} params - The GA4 event parameters object to modify
 * @param {string} eventType - The Square event type
 * @param {Object} eventData - The event data object
 * @param {Object} enrichedData - Optional enriched data from Square API
 */
function addEventParams(params, eventType, eventData, enrichedData) {
  // Add common parameters for all events
  params.merchant_id = eventData.merchant_id || '';
  params.location_id = eventData.location_id || '';
  
  // Add event-specific parameters based on event type
  switch (eventType) {
    case 'order.created':
    case 'order.updated':
    case 'order.fulfilled':
      addOrderParams(params, eventData, enrichedData);
      break;
      
    case 'payment.created':
    case 'payment.updated':
      addPaymentParams(params, eventData, enrichedData);
      break;
      
    case 'refund.created':
      addRefundParams(params, eventData, enrichedData);
      break;
      
    case 'customer.created':
    case 'customer.updated':
      addCustomerParams(params, eventData, enrichedData);
      break;
      
    default:
      // For other event types, add generic data
      Object.keys(eventData).forEach(key => {
        if (typeof eventData[key] !== 'object' && eventData[key] !== null) {
          params[`square_${key}`] = String(eventData[key]);
        }
      });
      break;
  }
}

/**
 * Add order-specific parameters
 * @param {Object} params - The GA4 params object to modify
 * @param {Object} orderData - The order data from webhook
 * @param {Object} enrichedData - Optional enriched data
 */
function addOrderParams(params, orderData, enrichedData) {
  // Use enriched data if available, otherwise use webhook data
  const order = enrichedData?.order?.order || orderData;
  const customer = enrichedData?.customer || null;
  
  params.transaction_id = order.id || '';
  params.affiliation = 'Square';
  
  // Add order total and currency
  if (order.total_money) {
    params.value = (order.total_money.amount || 0) / 100;
    params.currency = order.total_money.currency || 'USD';
  }
  
  // Add tax and shipping
  if (order.total_tax_money) {
    params.tax = (order.total_tax_money.amount || 0) / 100;
  }
  
  if (order.total_service_charge_money) {
    params.shipping = (order.total_service_charge_money.amount || 0) / 100;
  }
  
  // Add items
  if (order.line_items && order.line_items.length > 0) {
    params.items = order.line_items.map(item => {
      return {
        item_id: item.catalog_object_id || '',
        item_name: item.name || 'Unknown Item',
        quantity: item.quantity || 1,
        price: item.base_price_money ? (item.base_price_money.amount / 100) : 0,
        item_category: item.variation_name || ''
      };
    });
  }
  
  // Add customer data if available
  if (customer) {
    params.customer_id = customer.id || '';
    if (customer.email_address) params.email = customer.email_address;
    if (customer.given_name || customer.family_name) {
      params.customer_name = [customer.given_name, customer.family_name].filter(Boolean).join(' ');
    }
  }
}

/**
 * Add payment-specific parameters
 * @param {Object} params - The GA4 params object to modify
 * @param {Object} paymentData - The payment data from webhook
 * @param {Object} enrichedData - Optional enriched data
 */
function addPaymentParams(params, paymentData, enrichedData) {
  const payment = enrichedData?.payment || paymentData;
  
  params.transaction_id = payment.id || '';
  params.payment_status = payment.status || '';
  
  if (payment.amount_money) {
    params.value = (payment.amount_money.amount || 0) / 100;
    params.currency = payment.amount_money.currency || 'USD';
  }
  
  if (payment.payment_type) {
    params.payment_method = payment.payment_type;
  }
  
  if (payment.source_type) {
    params.payment_source = payment.source_type;
  }
  
  // Add order ID if available
  if (payment.order_id) {
    params.order_id = payment.order_id;
  }
  
  // Add location info
  if (payment.location_id) {
    params.location_id = payment.location_id;
  }
}

/**
 * Add refund-specific parameters
 * @param {Object} params - The GA4 params object to modify
 * @param {Object} refundData - The refund data from webhook
 * @param {Object} enrichedData - Optional enriched data
 */
function addRefundParams(params, refundData, enrichedData) {
  params.transaction_id = refundData.id || '';
  params.refund_status = refundData.status || '';
  
  if (refundData.amount_money) {
    params.value = (refundData.amount_money.amount || 0) / 100;
    params.currency = refundData.amount_money.currency || 'USD';
  }
  
  if (refundData.reason) {
    params.refund_reason = refundData.reason;
  }
  
  // Add payment ID if available
  if (refundData.payment_id) {
    params.payment_id = refundData.payment_id;
  }
}

/**
 * Add customer-specific parameters
 * @param {Object} params - The GA4 params object to modify
 * @param {Object} customerData - The customer data from webhook
 * @param {Object} enrichedData - Optional enriched data
 */
function addCustomerParams(params, customerData, enrichedData) {
  const customer = enrichedData || customerData;
  
  params.customer_id = customer.id || '';
  
  if (customer.email_address) {
    params.email = customer.email_address;
  }
  
  if (customer.given_name || customer.family_name) {
    params.customer_name = [customer.given_name, customer.family_name].filter(Boolean).join(' ');
  }
  
  if (customer.created_at) {
    params.customer_creation_date = customer.created_at;
  }
}

/**
 * Sends event data to Server GTM
 * @param {Object} webhookData - The webhook data
 * @param {Object} enrichedData - Optional enriched data
 * @returns {Promise<Object>} - Response from GTM server
 */
async function sendToServerGTM(webhookData, enrichedData) {
  const gtmServerUrl = process.env.GTM_SERVER_URL;
  if (!gtmServerUrl) {
    throw new Error('GTM server URL is not configured');
  }
  
  try {
    // Transform data for GA4
    const ga4Event = transformForGA4({ ...webhookData, enriched: enrichedData });
    if (!ga4Event) {
      console.error('Failed to transform webhook data for GA4');
      return null;
    }
    
    // Send to GTM server
    const response = await axios.post(gtmServerUrl, ga4Event, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Square-Webhook-Handler'
      },
      timeout: 5000 // 5 second timeout
    });
    
    console.log('Successfully sent to GTM server:', {
      status: response.status,
      eventType: webhookData.type,
      eventId: webhookData.event_id
    });
    
    return response.data;
  } catch (error) {
    console.error('Error sending to GTM server:', error.message);
    throw error;
  }
}

/**
 * Sends data to a CRM system
 * @param {Object} webhookData - The webhook data
 * @param {Object} enrichedData - Optional enriched data
 */
async function sendToCRM(webhookData, enrichedData) {
  const crmWebhookUrl = process.env.CRM_WEBHOOK_URL;
  if (!crmWebhookUrl) {
    console.log('CRM webhook URL not configured, skipping');
    return null;
  }
  
  try {
    // Format data for CRM
    const crmData = {
      source: 'square',
      event_type: webhookData.type,
      event_id: webhookData.event_id,
      timestamp: new Date().toISOString(),
      data: {
        ...webhookData.data,
        enriched: enrichedData
      }
    };
    
    // Send to CRM
    const response = await axios.post(crmWebhookUrl, crmData, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Square-Webhook-Handler'
      },
      timeout: 5000
    });
    
    console.log('Successfully sent to CRM:', {
      status: response.status,
      eventType: webhookData.type
    });
    
    return response.data;
  } catch (error) {
    console.error('Error sending to CRM:', error.message);
    return null;
  }
}

/**
 * Sends high-value order alert via email or notification service
 * @param {Object} webhookData - The webhook data
 * @param {Object} enrichedData - Optional enriched data
 */
async function sendHighValueOrderAlert(webhookData, enrichedData) {
  const notificationUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  if (!notificationUrl) {
    console.log('Notification webhook URL not configured, skipping');
    return null;
  }
  
  try {
    const orderData = enrichedData?.order?.order || webhookData.data?.object;
    const customerData = enrichedData?.customer || {};
    
    // Format notification data
    const notificationData = {
      type: 'high_value_order',
      order_id: orderData.id,
      order_total: orderData.total_money ? `${orderData.total_money.currency} ${orderData.total_money.amount / 100}` : 'Unknown',
      location_id: orderData.location_id,
      customer_name: customerData.given_name ? `${customerData.given_name} ${customerData.family_name || ''}` : 'Unknown Customer',
      customer_email: customerData.email_address || 'No email provided',
      timestamp: new Date().toISOString(),
      order_url: `https://squareup.com/dashboard/orders/${orderData.id}`
    };
    
    // Send notification
    const response = await axios.post(notificationUrl, notificationData, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Square-Webhook-Handler'
      }
    });
    
    console.log('Successfully sent high-value order alert');
    return response.data;
  } catch (error) {
    console.error('Error sending high-value order alert:', error.message);
    return null;
  }
}

/**
 * Logs event to analytics dashboard
 * @param {Object} webhookData - The webhook data
 */
async function logToAnalyticsDashboard(webhookData) {
  // This would integrate with your analytics dashboard
  // For now, we'll just log to console
  console.log('Event logged to analytics dashboard:', {
    event_type: webhookData.type,
    event_id: webhookData.event_id,
    timestamp: new Date().toISOString()
  });
  
  return true;
}

module.exports = {
  transformForGA4,
  sendToServerGTM,
  sendToCRM,
  sendHighValueOrderAlert,
  logToAnalyticsDashboard
};
