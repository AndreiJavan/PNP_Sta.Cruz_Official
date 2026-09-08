import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import expressLayouts from 'express-ejs-layouts';
import session from 'express-session';
import morgan from 'morgan';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { i18nMiddleware } from './middleware/i18n.js';
import { FileSessionStore } from './utils/sessionStore.js';

// Routes
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Favicon handler
app.get(['/favicon.ico', '/favicon.png'], (req, res) => res.status(204).end());

// Trust proxy for Vercel/Cloud Run
app.set('trust proxy', 1);

// Security Headers
app.use(helmet({
  contentSecurityPolicy: false, // Disabled to prevent blocking external CDNs like Leaflet/Mapbox/Supabase
  crossOriginEmbedderPolicy: false
}));

// Logger, Cookie Parser, CORS
app.use(morgan('dev'));
app.use(cookieParser());
app.use(cors({
  origin: true,
  credentials: true
}));

// Serve static assets BEFORE rate limiter so that assets never consume rate-limit quota
app.use(express.static(path.join(process.cwd(), 'public'), {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));

// Body Parsers
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Persistent Session Store (survives restarts, memory pressure, and worker recycles)
const sessionStore = new FileSessionStore();

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'stacruz-mapping-secure-session-key',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  name: 'stacruz_sid',
  proxy: true,
  cookie: {
    secure: false, // Set to false to allow HTTP in local dev / behind proxy without SSL termination issues
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  }
}));

// General Rate Limiter - Applied AFTER static files & session parsing
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Increased to 1000 requests per 15 minutes for public routes
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip static assets
    if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|geojson)$/i)) {
      return true;
    }
    // Skip health checks
    if (req.path === '/api/health') {
      return true;
    }
    // Skip authenticated admin sessions so active admin workflows are never blocked
    if (req.session && (req.session as any).user) {
      return true;
    }
    return false;
  }
});
app.use(limiter);

// i18n Internationalization Middleware
app.use(i18nMiddleware);





// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Global Variables for Views
app.use((req, res, next) => {
  // Set no-cache only for HTML dynamic page renders / API responses, preserving static asset caching
  if (!req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/i)) {
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');
  }

  res.locals.sessionId = req.sessionID;

  if (req.session) {
    res.locals.user = req.session.user || null;
    res.locals.success_msg = req.session.success_msg || null;
    res.locals.error_msg = req.session.error_msg || null;
    res.locals.hideSidebar = (req.session as any).hideSidebar || false;

    // Safely delete session messages
    const sessionAny = req.session as any;
    delete sessionAny.success_msg;
    delete sessionAny.error_msg;
  } else {
    res.locals.user = null;
    res.locals.success_msg = null;
    res.locals.error_msg = null;
  }
  next();
});

// Health Check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Routes
app.use('/', publicRoutes);
app.use('/admin', adminRoutes);

// 404 Handler
app.use((req, res, next) => {
  res.status(404).render('error', {
    error: new Error('The page you are looking for does not exist.')
  });
});

// Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server Error:', err);
  const status = err.status || 500;

  try {
    res.status(status).render('error', {
      error: {
        message: err.message || 'An unexpected error occurred.',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
      }
    });
  } catch (renderError) {
    console.error('Render Error:', renderError);
    res.status(status).send(`
      <h1>System Error</h1>
      <p>${err.message || 'An unexpected error occurred.'}</p>
      <hr>
      <p><small>Secondary error: Failed to render error page.</small></p>
    `);
  }
});

export default app;
