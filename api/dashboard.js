/**
 * Simple webhook activity dashboard
 * Provides visibility into processed and failed events
 */
const { getRecentEvents, getFailedEvents } = require('../lib/storage');

/**
 * Dashboard handler function
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 */
export default async function handler(req, res) {
  // Only allow GET method
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Check for authentication
  const authHeader = req.headers.authorization;
  const dashboardKey = process.env.DASHBOARD_API_KEY;
  
  if (dashboardKey && (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.substring(7) !== dashboardKey)) {
    return res.status(401).json({
      error: 'Unauthorized. Please provide a valid API key in the Authorization header.'
    });
  }
  
  try {
    // Get query parameters
    const limit = parseInt(req.query.limit) || 10;
    const format = req.query.format || 'json';  // 'json' or 'html'
    
    // Get recent events
    const recentEvents = await getRecentEvents(limit);
    
    // Get failed events awaiting retry
    const failedEventsJson = await getFailedEvents();
    const failedEvents = failedEventsJson.map(json => {
      try {
        return JSON.parse(json);
      } catch (e) {
        return { error: 'Failed to parse event data' };
      }
    });
    
    // Calculate summary metrics
    const eventTypeCounts = {};
    recentEvents.forEach(event => {
      const type = event.event_type || 'unknown';
      eventTypeCounts[type] = (eventTypeCounts[type] || 0) + 1;
    });
    
    const summary = {
      processed: {
        total: recentEvents.length,
        byType: eventTypeCounts
      },
      failed: {
        total: failedEvents.length,
        oldestTimestamp: failedEvents.length > 0 ? 
          failedEvents.sort((a, b) => new Date(a.failed_at) - new Date(b.failed_at))[0]?.failed_at : null
      },
      updatedAt: new Date().toISOString()
    };
    
    // Return response in the requested format
    if (format === 'html') {
      // Return HTML dashboard
      return res.status(200).send(generateHtmlDashboard(recentEvents, failedEvents, summary));
    } else {
      // Return JSON data
      return res.status(200).json({
        summary,
        recentEvents,
        failedEvents
      });
    }
  } catch (error) {
    console.error('Error generating dashboard:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

/**
 * Generate HTML dashboard
 * @param {Array} recentEvents - Recently processed events
 * @param {Array} failedEvents - Failed events awaiting retry
 * @param {Object} summary - Summary metrics
 * @returns {string} - HTML content
 */
function generateHtmlDashboard(recentEvents, failedEvents, summary) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Square Webhook Dashboard</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    h1, h2, h3 {
      color: #111;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      border-bottom: 1px solid #eee;
      padding-bottom: 10px;
    }
    .timestamp {
      color: #666;
      font-size: 0.8em;
    }
    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 15px;
      flex: 1;
      min-width: 200px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .stat-value {
      font-size: 2em;
      font-weight: bold;
      margin: 10px 0;
    }
    .events-container {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
    }
    .events-section {
      flex: 1;
      min-width: 500px;
    }
    .event {
      background: white;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 15px;
      margin-bottom: 10px;
    }
    .event-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .event-type {
      font-weight: bold;
    }
    .failed {
      background-color: #fff8f8;
      border-left: 4px solid #dc3545;
    }
    .success {
      border-left: 4px solid #28a745;
    }
    pre {
      background: #f5f5f5;
      padding: 10px;
      overflow: auto;
      border-radius: 4px;
      font-size: 0.9em;
    }
    .error-message {
      color: #dc3545;
      margin: 10px 0;
    }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 0.8em;
      background: #e9ecef;
    }
    .badge-danger {
      background: #f8d7da;
      color: #721c24;
    }
    .badge-success {
      background: #d4edda;
      color: #155724;
    }
    .retry-button {
      margin-top: 20px;
      padding: 10px 15px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .retry-button:hover {
      background: #0069d9;
    }
    .refresh-link {
      color: #007bff;
      text-decoration: none;
      font-size: 0.9em;
    }
    .refresh-link:hover {
      text-decoration: underline;
    }
    .type-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Square Webhook Dashboard</h1>
    <div>
      <span class="timestamp">Last updated: ${summary.updatedAt}</span>
      <div>
        <a href="?format=html" class="refresh-link">↻ Refresh Dashboard</a>
      </div>
    </div>
  </div>

  <div class="stats">
    <div class="stat-card">
      <h3>Processed Events</h3>
      <div class="stat-value">${summary.processed.total}</div>
      <div class="type-summary">
        ${Object.entries(summary.processed.byType).map(([type, count]) => 
          `<span class="badge badge-success">${type}: ${count}</span>`
        ).join('')}
      </div>
    </div>
    <div class="stat-card">
      <h3>Failed Events</h3>
      <div class="stat-value">${summary.failed.total}</div>
      ${summary.failed.total > 0 ? 
        `<div>Oldest: ${new Date(summary.failed.oldestTimestamp).toLocaleString()}</div>` : 
        '<div>No failed events!</div>'
      }
      ${summary.failed.total > 0 ? 
        `<a href="/api/retry-failed-events" target="_blank" class="retry-button">Retry Failed Events</a>` : 
        ''
      }
    </div>
  </div>

  <div class="events-container">
    <div class="events-section">
      <h2>Recent Events</h2>
      ${recentEvents.length === 0 ? '<p>No recent events found.</p>' : ''}
      ${recentEvents.map(event => `
        <div class="event success">
          <div class="event-header">
            <span class="event-type">${event.event_type || 'Unknown Type'}</span>
            <span class="timestamp">${new Date(event.processed_at).toLocaleString()}</span>
          </div>
          <div>Event ID: ${event.data?.event_id || 'N/A'}</div>
          ${event.data?.merchant_id ? `<div>Merchant ID: ${event.data.merchant_id}</div>` : ''}
          <details>
            <summary>Event Data</summary>
            <pre>${JSON.stringify(event.data, null, 2)}</pre>
          </details>
        </div>
      `).join('')}
    </div>

    <div class="events-section">
      <h2>Failed Events</h2>
      ${failedEvents.length === 0 ? '<p>No failed events pending retry.</p>' : ''}
      ${failedEvents.map(event => `
        <div class="event failed">
          <div class="event-header">
            <span class="event-type">${event.event_data?.type || 'Unknown Type'}</span>
            <span class="timestamp">${new Date(event.failed_at).toLocaleString()}</span>
          </div>
          <div>Event ID: ${event.event_data?.event_id || 'N/A'}</div>
          <div class="error-message">Error: ${event.error || 'Unknown error'}</div>
          <div>Retry Count: ${event.retry_count || 0}</div>
          <details>
            <summary>Event Data</summary>
            <pre>${JSON.stringify(event.event_data, null, 2)}</pre>
          </details>
        </div>
      `).join('')}
    </div>
  </div>

  <script>
    // Auto-refresh every 60 seconds
    setTimeout(() => {
      window.location.reload();
    }, 60000);
  </script>
</body>
</html>
  `;
}
