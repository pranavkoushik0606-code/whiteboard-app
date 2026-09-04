import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import path from 'path';
import { fileURLToPath } from 'url';

import { connectDB } from './config/db.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { initSocket } from './socket/socketHandler.js';

import authRoutes from './routes/authRoutes.js';
import boardRoutes from './routes/boardRoutes.js';
import canvasRoutes from './routes/canvasRoutes.js';
import commentRoutes from './routes/commentRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// ---- Security & core middleware ----
app.use(helmet());
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(mongoSanitize()); // strips $ and . operators from req.body/query/params to block NoSQL injection
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// The e2e suite signs up a fresh set of users per test and would exhaust these
// within a run. NODE_ENV=test is set only by e2e/global-setup.ts, never by any
// deploy config, so production and development limits are unaffected.
const skipRateLimit = () => process.env.NODE_ENV === 'test';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipRateLimit,
});
app.use('/api', apiLimiter);

// stricter on auth to slow brute force
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, skip: skipRateLimit });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);

// Static file serving for locally uploaded images
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ---- Routes ----
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/api/auth', authRoutes);
app.use('/api/boards', boardRoutes);
app.use('/api/canvas', canvasRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/notifications', notificationRoutes);

app.use(notFound);
app.use(errorHandler);

// ---- Socket.io ----
const io = new Server(server, { cors: { origin: CLIENT_URL, credentials: true } });
initSocket(io);

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
