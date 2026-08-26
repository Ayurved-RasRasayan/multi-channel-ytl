const request = require('supertest');
const express = require('express');
const session = require('express-session');

const app = express();
app.use(express.json());
app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false
}));

const authRoutes = require('../routes/auth');
app.use('/api', authRoutes);

describe('Authentication API', () => {
    it('GET /api/auth/status returns unauthenticated when not logged in', async () => {
        const res = await request(app).get('/api/auth/status');
        expect(res.statusCode).toEqual(200);
        expect(res.body.isAuthenticated).toBe(false);
    });

    it('POST /api/login authenticates valid user', async () => {
        const res = await request(app)
            .post('/api/login')
            .send({ username: 'admin', password: 'password123' });
        expect(res.statusCode).toEqual(200);
        expect(res.body.success).toBe(true);
    });

    it('POST /api/login rejects invalid credentials', async () => {
        const res = await request(app)
            .post('/api/login')
            .send({ username: 'admin', password: 'wrongpassword' });
        expect(res.statusCode).toEqual(401);
        expect(res.body.success).toBe(false);
    });
});

describe('Duplicate Channel Helper Functionality', () => {
    function isDuplicateChannel(targetUrl, channels) {
        if (!targetUrl || !channels || channels.length === 0) return false;

        function extractHandle(urlOrName) {
            if (!urlOrName) return '@unknown';
            if (urlOrName.startsWith('@')) return urlOrName;
            const patterns = [
                /\/@([^/?]+)/,
                /youtube\.com\/c\/([^/?]+)/,
                /youtube\.com\/channel\/([^/?]+)/,
                /youtube\.com\/user\/([^/?]+)/
            ];
            for (const pattern of patterns) {
                const match = urlOrName.match(pattern);
                if (match) return '@' + match[1];
            }
            return '@' + urlOrName.replace(/\s+/g, '').substring(0, 20);
        }

        const cleanTarget = String(targetUrl).trim().toLowerCase().replace(/\/$/, '');
        const targetHandle = extractHandle(targetUrl).toLowerCase();

        return channels.some(ch => {
            const chId = String(ch.id || '').toLowerCase();
            const chName = String(ch.name || '').toLowerCase();
            const chUrl = String(ch.url || '').toLowerCase().replace(/\/$/, '');
            const chHandle = String(ch.handle || extractHandle(ch.url || ch.name) || '').toLowerCase();
            const chYoutubeId = String(ch.data?.youtubeId || ch.youtubeId || '').toLowerCase();

            if (chId && chId === cleanTarget) return true;
            if (chYoutubeId && chYoutubeId === cleanTarget) return true;
            if (chUrl && (chUrl === cleanTarget || chUrl.split('/').pop() === cleanTarget)) return true;
            if (chName && (chName === cleanTarget || chName === cleanTarget.replace(/^@/, ''))) return true;
            if (chHandle && chHandle !== '@unknown' && targetHandle !== '@unknown' && chHandle === targetHandle) return true;
            if (chHandle && (chHandle === cleanTarget || chHandle.replace(/^@/, '') === cleanTarget.replace(/^@/, ''))) return true;

            return false;
        });
    }

    it('identifies duplicate channel by URL or handle correctly', () => {
        const channels = [
            { id: '123', name: 'TestChannel', url: 'https://www.youtube.com/@TestChannel', handle: '@TestChannel', youtubeId: 'TestChannel' }
        ];

        expect(isDuplicateChannel('https://www.youtube.com/@TestChannel', channels)).toBe(true);
        expect(isDuplicateChannel('@TestChannel', channels)).toBe(true);
        expect(isDuplicateChannel('TestChannel', channels)).toBe(true);
        expect(isDuplicateChannel('https://www.youtube.com/@NewChannel', channels)).toBe(false);
    });
});
