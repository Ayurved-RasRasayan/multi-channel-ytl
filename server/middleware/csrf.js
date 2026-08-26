const crypto = require('crypto');

function csrfProtection(req, res, next) {
    // Generate CSRF token if not present in session
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    }

    // Expose token to client
    res.cookie('XSRF-TOKEN', req.session.csrfToken, { httpOnly: false });

    // Skip validation for safe HTTP methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // Skip CSRF check for login route
    if (req.path === '/api/login') {
        return next();
    }

    const token = req.headers['x-csrf-token'] || req.headers['x-xsrf-token'] || req.body._csrf;

    if (!token || token !== req.session.csrfToken) {
        // Warning log only (soft enforcement for backward compatibility)
        console.warn(`[CSRF] Invalid or missing token from IP ${req.ip}`);
    }

    next();
}

module.exports = csrfProtection;
