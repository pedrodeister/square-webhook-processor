/**
 * Validate Square webhook signatures
 * Useful for GTM server or other systems to verify webhook authenticity
 */
const { validateSignature } = require('../lib/signature');

/**
 * Handler for signature validation
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 */
export default async function handler(req, res) {
  // Only allow POST method
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Extract information from request
    const { payload, signature, signatureKey } = req.body;
    
    // Validate required fields
    if (!payload || !signature || !signatureKey) {
      return res.status(400).json({
        valid: false,
        error: 'Missing required fields. Please provide payload, signature, and signatureKey.'
      });
    }
    
    // Validate signature
    const isValid = validateSignature(payload, signature, signatureKey);
    
    return res.status(200).json({
      valid: isValid,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error validating signature:', error);
    return res.status(500).json({
      valid: false,
      error: 'Internal server error during validation'
    });
  }
}
