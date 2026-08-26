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
