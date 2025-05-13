/**
 * Square webhook signature validation utilities
 */
const crypto = require('crypto');

/**
 * Validates the signature of a Square webhook payload
 * @param {string} payload - The raw JSON payload as a string
 * @param {string} signature - The signature from the X-Square-HMACSHA256-Signature header
 * @param {string} signatureKey - The webhook signature key from Square dashboard
 * @returns {boolean} - True if signature is valid, false otherwise
 */
function validateSignature(payload, signature, signatureKey) {
  if (!payload || !signature || !signatureKey) {
    console.error('Missing required parameters for signature validation');
    return false;
  }

  try {
    // Create HMAC using the signature key
    const hmac = crypto.createHmac('sha256', Buffer.from(signatureKey, 'utf8'));
    
    // Update HMAC with the payload
    hmac.update(payload);
    
    // Get the digest in hex format
    const calculatedSignature = hmac.digest('hex');
    
    // Compare the calculated signature with the provided signature
    return crypto.timingSafeEqual(
      Buffer.from(calculatedSignature, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch (error) {
    console.error('Error validating signature:', error);
    return false;
  }
}

/**
 * Generate a test signature for local testing
 * @param {Object} payload - The payload object
 * @param {string} signatureKey - The webhook signature key
 * @returns {string} - The generated signature
 */
function generateTestSignature(payload, signatureKey) {
  const hmac = crypto.createHmac('sha256', Buffer.from(signatureKey, 'utf8'));
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex');
}

module.exports = {
  validateSignature,
  generateTestSignature
};
