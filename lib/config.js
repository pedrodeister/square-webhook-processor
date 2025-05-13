/**
 * Centralized configuration and environment variable validation
 * This file validates critical environment variables at application startup
 */

/**
 * Environment variable configuration with validation rules
 */
const CONFIG = {
  // Square API Configuration
  SQUARE_SIGNATURE_KEY: {
    required: true,
    description: 'Webhook signature key from Square dashboard',
    validate: value => typeof value === 'string' && value.length > 0
  },
  SQUARE_ACCESS_TOKEN: {
    required: true,
    description: 'Access token for Square API',
    validate: value => typeof value === 'string' && value.length > 0
  },
  
  // Vercel KV Storage Configuration
  KV_REST_API_URL: {
    required: true,
    description: 'Vercel KV Storage REST API URL',
    validate: value => typeof value === 'string' && value.includes('://')
  },
  KV_REST_API_TOKEN: {
    required: true,
    description: 'Vercel KV Storage REST API Token',
    validate: value => typeof value === 'string' && value.length > 0
  },
  
  // Integration Endpoints
  GTM_SERVER_URL: {
    required: false,
    description: 'Server GTM endpoint',
    validate: value => typeof value === 'string' && value.includes('://')
  },
  CRM_WEBHOOK_URL: {
    required: false,
    description: 'CRM webhook URL',
    validate: value => !value || (typeof value === 'string' && value.includes('://'))
  },
  NOTIFICATION_WEBHOOK_URL: {
    required: false,
    description: 'Notification service webhook URL',
    validate: value => !value || (typeof value === 'string' && value.includes('://'))
  },
  
  // Application Configuration
  NODE_ENV: {
    required: false,
    description: 'Node environment (development, production)',
    default: 'development',
    validate: value => ['development', 'production', 'test'].includes(value)
  },
  HIGH_VALUE_THRESHOLD: {
    required: false,
    description: 'Threshold for high-value orders',
    default: '100',
    validate: value => !value || !isNaN(Number(value))
  },
  DASHBOARD_API_KEY: {
    required: false,
    description: 'API key for dashboard access',
    validate: value => !value || (typeof value === 'string' && value.length > 10)
  },
  RETRY_SECRET_KEY: {
    required: false,
    description: 'Secret key for retry endpoint',
    validate: value => !value || (typeof value === 'string' && value.length > 10)
  }
};

/**
 * Validate all environment variables
 * @returns {Object} - Validation results with any errors
 */
function validateConfig() {
  const results = {
    isValid: true,
    errors: [],
    warnings: []
  };
  
  for (const [key, config] of Object.entries(CONFIG)) {
    // Check if required variables exist
    if (config.required && !process.env[key]) {
      results.isValid = false;
      results.errors.push({
        key,
        message: `Missing required environment variable: ${key}`,
        description: config.description
      });
      continue;
    }
    
    // Set default value if not provided
    if (!process.env[key] && config.default) {
      process.env[key] = config.default;
    }
    
    // Validate value if present
    if (process.env[key] && config.validate && !config.validate(process.env[key])) {
      if (config.required) {
        results.isValid = false;
        results.errors.push({
          key,
          message: `Invalid value for environment variable: ${key}`,
          description: config.description
        });
      } else {
        results.warnings.push({
          key,
          message: `Invalid value for optional environment variable: ${key}`,
          description: config.description
        });
      }
    }
  }
  
  return results;
}

/**
 * Get configuration value with type conversion
 * @param {string} key - Configuration key
 * @param {any} defaultValue - Default value if not found
 * @returns {any} - Configuration value
 */
function get(key, defaultValue = null) {
  if (!CONFIG[key]) {
    console.warn(`Accessing undefined configuration key: ${key}`);
    return defaultValue;
  }
  
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  
  // Convert value based on defaultValue type
  if (defaultValue !== null) {
    switch (typeof defaultValue) {
      case 'number':
        return Number(value);
      case 'boolean':
        return value === 'true' || value === '1';
      default:
        return value;
    }
  }
  
  return value;
}

// Run validation on module load
const validationResults = validateConfig();

// Log validation results
if (!validationResults.isValid) {
  console.error('Configuration validation failed:', validationResults.errors);
  
  // In production, exit the process if configuration is invalid
  if (process.env.NODE_ENV === 'production') {
    console.error('Exiting due to invalid configuration in production environment');
    process.exit(1);
  }
}

if (validationResults.warnings.length > 0) {
  console.warn('Configuration warnings:', validationResults.warnings);
}

module.exports = {
  validate: validateConfig,
  get,
  CONFIG
};
