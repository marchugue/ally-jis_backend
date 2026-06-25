import express from 'express';
import cors from 'cors';
import routes from './routes';
import { errorHandler } from './app/middleware/error.middleware';
import { env } from './config/env';

const app = express();
app.use((req, res, next) => {
  console.log(`→ ${req.method} ${req.path}`);
  next();
});
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, postman)
      if (!origin) return callback(null, true);
      
      if (
        env.WEB_URL === '*' ||
        origin === env.WEB_URL ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:')
      ) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);
app.use(express.json());
app.use('/api', routes);
app.use(errorHandler);

export default app;