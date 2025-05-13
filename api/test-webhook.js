/**
 * Test endpoint to simulate Square webhooks
 * Useful for local development and testing
 */
const { generateTestSignature } = require('../lib/signature');
const axios = require('axios');

// Sample webhook events for different types
const sampleEvents = {
  // Order created event
  orderCreated: {
    merchant_id: "MLEFBHHSJGVJD",
    type: "order.created",
    event_id: "00000000-0000-0000-0000-000000000001",
    created_at: new Date().toISOString(),
    data: {
      type: "order",
      id: "6KbXqPQeMVp6BoO9BZB7OQ",
      object: {
        id: "6KbXqPQeMVp6BoO9BZB7OQ",
        location_id: "LCCMJSRT4XM8R",
        order_type: "ONLINE",
        state: "OPEN",
        created_at: new Date().toISOString(),
        total_money: {
          amount: 2650,
          currency: "USD"
        },
        total_tax_money: {
          amount: 150,
          currency: "USD"
        },
        line_items: [
          {
            uid: "Z6WSRP3QGG7ZEI2SPCSSES6D",
            name: "Test Item 1",
            quantity: "1",
            catalog_object_id: "LBTYIPI7TQOXY4ADBCU2FCWY",
            variation_name: "Regular",
            base_price_money: {
              amount: 1500,
              currency: "USD"
            },
            gross_sales_money: {
              amount: 1500,
              currency: "USD"
            },
            total_tax_money: {
              amount: 90,
              currency: "USD"
            }
          },
          {
            uid: "Z6WSRP3QGG7ZEI2SPCSSES6E",
            name: "Test Item 2",
            quantity: "1",
            catalog_object_id: "LBTYIPI7TQOXY4ADBCU2FKLP",
            variation_name: "Large",
            base_price_money: {
              amount: 1000,
              currency: "USD"
            },
            gross_sales_money: {
              amount: 1000,
              currency: "USD"
            },
            total_tax_money: {
              amount: 60,
              currency: "USD"
            }
          }
        ]
      }
    }
  },
  
  // Payment created event
  paymentCreated: {
    merchant_id: "MLEFBHHSJGVJD",
    type: "payment.created",
    event_id: "00000000-0000-0000-0000-000000000002",
    created_at: new Date().toISOString(),
    data: {
      type: "payment",
      id: "GQTFp1ZlXdpoW4o6eGiZhMAAAAQ",
      object: {
        id: "GQTFp1ZlXdpoW4o6eGiZhMAAAAQ",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "COMPLETED",
        location_id: "LCCMJSRT4XM8R",
        order_id: "6KbXqPQeMVp6BoO9BZB7OQ",
        source_type: "CARD",
        amount_money: {
          amount: 2650,
          currency: "USD"
        },
        card_details: {
          status: "CAPTURED",
          card: {
            card_brand: "VISA",
            last_4: "1111",
            bin: "411111"
          }
        },
        receipt_number: "AQTP"
      }
    }
  },
  
  // Customer created event
  customerCreated: {
    merchant_id: "MLEFBHHSJGVJD",
    type: "customer.created",
    event_id: "00000000-0000-0000-0000-000000000003",
    created_at: new Date().toISOString(),
    data: {
      type: "customer",
      id: "NBHWYPJHTER72S7WFMN4UBPX54",
      object: {
        id: "NBHWYPJHTER72S7WFMN4UBPX54",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        given_name: "John",
        family_name: "Doe",
        email_address: "johndoe@example.com",
        phone_number: "+12025551212",
        preferences: {
          email_unsubscribed: false
        },
        created_source: {
          product: "DASHBOARD",
          application_id: "sq0idp-J76CcbVj33DklCEfFKbCug",
          name: "Square Point of Sale 4.32"
        }
      }
    }
  },
  
  // Refund created event
  refundCreated: {
    merchant_id: "MLEFBHHSJGVJD",
    type: "refund.created",
    event_id: "00000000-0000-0000-0000-000000000004",
    created_at: new Date().toISOString(),
    data: {
      type: "refund",
      id: "RgQ9M9bTGlfixR7WpazmxAAAAAQ",
      object: {
        id: "RgQ9M9bTGlfixR7WpazmxAAAAAQ",
        location_id: "LCCMJSRT4XM8R",
        payment_id: "GQTFp1ZlXdpoW4o6eGiZhMAAAAQ",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "COMPLETED",
        amount_money: {
          amount: 2650,
          currency: "USD"
        },
        reason: "Customer request"
      }
    }
  }
};

/**
 * Generate a timestamped event ID to make each event unique
 * @returns {string} - Unique event ID
 */
function generateUniqueEventId() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `test-${timestamp}-${random}`;
}

/**
 * Test webhook handler function
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 */
export default async function handler(req, res) {
  // Only allow POST method
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // For GET requests, show the test UI
  if (req.method === 'GET') {
    return res.status(200).send(generateTestUI());
  }
  
  try {
    // Extract request data
    const { 
      webhookType = 'orderCreated',
      targetUrl,
      signatureKey = 'test-signature-key',
      sendSignature = true,
      uniqueEventId = true
    } = req.body;
    
    // Validate required fields
    if (!targetUrl) {
      return res.status(400).json({
        success: false,
        error: 'Target URL is required'
      });
    }
    
    // Get the sample event based on type
    let event = { ...sampleEvents[webhookType] };
    if (!event) {
      return res.status(400).json({
        success: false,
        error: `Unknown webhook type: ${webhookType}`
      });
    }
    
    // Generate a unique event ID if requested
    if (uniqueEventId) {
      event.event_id = generateUniqueEventId();
    }
    
    // Update timestamps to current time
    event.created_at = new Date().toISOString();
    if (event.data?.object?.created_at) {
      event.data.object.created_at = new Date().toISOString();
    }
    if (event.data?.object?.updated_at) {
      event.data.object.updated_at = new Date().toISOString();
    }
    
    // Generate signature if requested
    const payload = JSON.stringify(event);
    let signature = null;
    if (sendSignature) {
      signature = generateTestSignature(event, signatureKey);
    }
    
    // Send webhook to target URL
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (sendSignature) {
      headers['X-Square-HMACSHA256-Signature'] = signature;
    }
    
    // Send the webhook
    const response = await axios.post(targetUrl, event, { headers });
    
    return res.status(200).json({
      success: true,
      eventType: event.type,
      eventId: event.event_id,
      target: targetUrl,
      targetResponse: {
        status: response.status,
        statusText: response.statusText,
        data: response.data
      },
      signature: signature,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error sending test webhook:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      targetResponse: error.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      } : null
    });
  }
}

/**
 * Generate HTML UI for testing webhooks
 * @returns {string} - HTML content
 */
function generateTestUI() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Square Webhook Tester</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    h1, h2 {
      color: #111;
    }
    .form-group {
      margin-bottom: 15px;
    }
    label {
      display: block;
      margin-bottom: 5px;
      font-weight: bold;
    }
    input[type="text"],
    select {
      width: 100%;
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      box-sizing: border-box;
    }
    .checkbox-group {
      margin-top: 10px;
    }
    .checkbox-group label {
      display: inline;
      font-weight: normal;
    }
    button {
      background: #007bff;
      color: white;
      border: none;
      padding: 10px 15px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1em;
    }
    button:hover {
      background: #0069d9;
    }
    #result {
      margin-top: 20px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 4px;
      display: none;
    }
    .success {
      color: #28a745;
    }
    .error {
      color: #dc3545;
    }
    pre {
      background: #f5f5f5;
      padding: 10px;
      overflow: auto;
      border-radius: 4px;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <h1>Square Webhook Tester</h1>
  <p>Use this tool to simulate Square webhook events for testing.</p>
  
  <form id="webhookForm">
    <div class="form-group">
      <label for="webhookType">Webhook Event Type</label>
      <select id="webhookType" name="webhookType">
        <option value="orderCreated">Order Created</option>
        <option value="paymentCreated">Payment Created</option>
        <option value="customerCreated">Customer Created</option>
        <option value="refundCreated">Refund Created</option>
      </select>
    </div>
    
    <div class="form-group">
      <label for="targetUrl">Target Webhook URL</label>
      <input type="text" id="targetUrl" name="targetUrl" placeholder="https://your-webhook-endpoint.vercel.app/api/square-webhook" value="/api/square-webhook">
    </div>
    
    <div class="form-group">
      <label for="signatureKey">Signature Key</label>
      <input type="text" id="signatureKey" name="signatureKey" placeholder="Your webhook signature key" value="test-signature-key">
    </div>
    
    <div class="checkbox-group">
      <input type="checkbox" id="sendSignature" name="sendSignature" checked>
      <label for="sendSignature">Send Signature Header</label>
    </div>
    
    <div class="checkbox-group">
      <input type="checkbox" id="uniqueEventId" name="uniqueEventId" checked>
      <label for="uniqueEventId">Generate Unique Event ID</label>
    </div>
    
    <button type="submit">Send Test Webhook</button>
  </form>
  
  <div id="result">
    <h2>Result</h2>
    <div id="resultContent"></div>
  </div>
  
  <script>
    document.getElementById('webhookForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const form = e.target;
      const resultDiv = document.getElementById('result');
      const resultContent = document.getElementById('resultContent');
      
      // Show loading state
      resultDiv.style.display = 'block';
      resultContent.innerHTML = 'Sending webhook...';
      
      try {
        // Prepare form data
        const formData = {
          webhookType: form.webhookType.value,
          targetUrl: form.targetUrl.value,
          signatureKey: form.signatureKey.value,
          sendSignature: form.sendSignature.checked,
          uniqueEventId: form.uniqueEventId.checked
        };
        
        // Send the request
        const response = await fetch('/api/test-webhook', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        // Display result
        if (data.success) {
          resultContent.innerHTML = \`
            <p class="success">Webhook sent successfully!</p>
            <p><strong>Event Type:</strong> \${data.eventType}</p>
            <p><strong>Event ID:</strong> \${data.eventId}</p>
            <p><strong>Target Response:</strong> \${data.targetResponse.status} \${data.targetResponse.statusText}</p>
            <p><strong>Signature:</strong> \${data.signature || 'Not sent'}</p>
            <p><strong>Timestamp:</strong> \${data.timestamp}</p>
            <details>
              <summary>Target Response Data</summary>
              <pre>\${JSON.stringify(data.targetResponse.data, null, 2) || 'No response data'}</pre>
            </details>
          \`;
        } else {
          resultContent.innerHTML = \`
            <p class="error">Error sending webhook: \${data.error}</p>
            <details>
              <summary>Error Details</summary>
              <pre>\${JSON.stringify(data, null, 2)}</pre>
            </details>
          \`;
        }
      } catch (error) {
        resultContent.innerHTML = \`
          <p class="error">Error: \${error.message}</p>
        \`;
      }
    });
  </script>
</body>
</html>
  `;
}
