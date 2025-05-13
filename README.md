# Square Webhook Validation Microservice

A complete webhook processing hub for Square events with signature validation, idempotency, and data enrichment.

## Features

- **Webhook Validation**: Secure signature validation for Square webhooks
- **Idempotency Management**: Prevent duplicate processing of events using Vercel KV Storage
- **Data Enrichment**: Enhance webhook data with additional information from Square API
- **Multi-Destination Distribution**: Send events to GTM, CRM systems, and notification services
- **Error Recovery**: Automatic retry system for failed events
- **Dashboard**: Simple monitoring interface for webhook activity
- **Testing Tools**: Built-in webhook simulator for development

## API Endpoints

- `/api/square-webhook`: Main webhook handler
- `/api/validate`: Signature validation endpoint
- `/api/retry-failed-events`: Retry mechanism for failed events
- `/api/dashboard`: Webhook activity dashboard
- `/api/test-webhook`: Test endpoint for simulating webhooks

## Deployment

1. Configure environment variables:
   - `SQUARE_SIGNATURE_KEY`: Your webhook signature key from Square
   - `SQUARE_ACCESS_TOKEN`: Square API access token
   - `GTM_SERVER_URL`: Server GTM endpoint
   - `CRM_WEBHOOK_URL` (optional): CRM webhook URL
   - `NOTIFICATION_WEBHOOK_URL` (optional): Notification service URL
   - `HIGH_VALUE_THRESHOLD` (optional): Threshold for high-value orders (default: 100)
   - `DASHBOARD_API_KEY` (optional): API key for dashboard access
   - `RETRY_SECRET_KEY` (optional): Secret key for retry endpoint

2. Set up Vercel KV Storage:
   ```
   vercel kv:create webhook-store
   vercel env add KV_REST_API_URL
   vercel env add KV_REST_API_TOKEN
   ```

3. Deploy to Vercel:
   ```
   vercel
   ```

## Development

```
npm install
vercel dev
```

## License

MIT
