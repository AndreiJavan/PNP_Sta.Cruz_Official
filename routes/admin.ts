import { Router } from 'express';
import {
  getLogin, postLogin, getLogout, getDashboard, getBulletins, getCreateBulletin,
  postCreateBulletin, getEditBulletin, postEditBulletin, deleteBulletin, getMap, postMapPoint, deleteMapPoint, bulkAddMapPoints, purgePlaceholders,
  getReports, processAIExtraction, saveReportBatch, deleteReport, getHotlines,
  postHotline, postEditHotline, deleteHotline, getUsers, postUser, deleteUser, getAuditLogs, approveUser, rejectUser,
  getAITrendsAnalysis
} from '../controllers/adminController.js';
import { isAuthenticated } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import multer from 'multer';
import rateLimit from 'express-rate-limit';

const router = Router();
const memoryUpload = multer({ storage: multer.memoryStorage() });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login requests per window
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).render('admin/login', {
      title: 'Admin Login',
      layout: false,
      error_msg: 'Too many login attempts. Please try again after 15 minutes.'
    });
  }
});

// Public Admin Routes
router.get('/login', getLogin);
router.post('/login', loginLimiter, postLogin);
router.get('/logout', getLogout);
router.get('/users/:id/approve', approveUser);
router.get('/users/:id/reject', rejectUser);

// Protected Admin Routes
router.use(isAuthenticated);

router.get('/dashboard', getDashboard);
router.get('/api/ai-trends', getAITrendsAnalysis);
router.get('/audit-logs', getAuditLogs);
router.post('/api/toggle-sidebar', (req: any, res) => {
  if (req.session) {
    req.session.hideSidebar = req.body.hideSidebar;
  }
  res.json({ success: true });
});

// Bulletins
router.get('/bulletins', getBulletins);
router.get('/bulletins/create', getCreateBulletin);
router.post('/bulletins/create', memoryUpload.array('photos', 5), postCreateBulletin);
router.get('/bulletins/:id/edit', getEditBulletin);
router.post('/bulletins/:id/edit', memoryUpload.array('photos', 5), postEditBulletin);
router.post('/bulletins/:id/delete', deleteBulletin);


// Map
router.get('/map', getMap);
router.post('/map/add', postMapPoint);
router.post('/map/delete/:id', deleteMapPoint);
router.post('/map/bulk-add', bulkAddMapPoints);
router.post('/map/purge-placeholders', purgePlaceholders);

// Intelligence Reports
router.get('/reports', getReports);
router.post('/reports/extract', memoryUpload.single('file'), processAIExtraction);
router.post('/process-ai', memoryUpload.single('file'), processAIExtraction);
router.post('/reports/save', saveReportBatch);
router.post('/reports/:id/delete', deleteReport);

// Hotlines
router.get('/hotlines', getHotlines);
router.post('/hotlines/add', postHotline);
router.post('/hotlines/:id/edit', postEditHotline);
router.post('/hotlines/:id/delete', deleteHotline);

// Personnel Management
router.get('/users', getUsers);
router.post('/users/add', postUser);
router.post('/users/:id/delete', deleteUser);

export default router;
