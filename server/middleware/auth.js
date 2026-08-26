const session = require('express-session');
const rateLimit = require('express-rate-limit');

const AUTH_CONFIG = {
    username: 'admin',
    password: 'password123',
    sessionSecret: 'ytl-secret-key-2024',
    sessionMaxAge: 2 * 24 * 60 * 60 * 1000,
    cookieFilePath: process.env.COOKIE_FILE_PATH || 'cookies.txt',
    browserName: 'edge'
};

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: {
        success: false,
        error: 'Too many login attempts. Please try again after 15 minutes.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false
});

const publicRoutes = [
    '/api/login',
    '/api/health',
    '/login',
    '/api/auth/status'
];

function requireAuth(req, res, next) {
    if (publicRoutes.some(route => req.path.startsWith(route))) {
        return next();
    }

    if (req.session && req.session.isAuthenticated) {
        return next();
    }

    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required',
            code: 'AUTH_REQUIRED'
        });
    }

    return res.redirect('/login');
}

module.exports = {
    AUTH_CONFIG,
    loginLimiter,
    requireAuth
};
