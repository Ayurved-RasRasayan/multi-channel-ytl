const express = require('express');
const router = express.Router();
const { AUTH_CONFIG, loginLimiter } = require('../middleware/auth');

router.post('/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;

    if (username === AUTH_CONFIG.username && password === AUTH_CONFIG.password) {
        req.session.isAuthenticated = true;
        req.session.user = username;
        req.session.loginTime = new Date().toISOString();
        req.session.loginIP = req.ip;

        return res.json({
            success: true,
            message: 'Login successful',
            user: username,
            redirectTo: '/'
        });
    }

    return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
    });
});

router.post('/logout', (req, res) => {
    const user = req.session.user;
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Logout failed' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

router.get('/auth/status', (req, res) => {
    if (req.session && req.session.isAuthenticated) {
        res.json({
            isAuthenticated: true,
            user: req.session.user,
            loginTime: req.session.loginTime,
            sessionAge: req.session.loginTime ?
                Math.floor((Date.now() - new Date(req.session.loginTime).getTime()) / 1000 / 60) : 0
        });
    } else {
        res.json({ isAuthenticated: false });
    }
});

module.exports = router;
