import { Router } from 'express';
import * as adminController from '../controllers/adminController.js';
import { isAuthenticated, isSuperAdmin } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import multer from 'multer';

const router = Router();
const memoryUpload = multer({ storage: multer.memoryStorage() });

// Public Admin Routes
router.get('/login', adminController.getLogin);
router.post('/login', adminController.postLogin);
router.get('/logout', adminController.getLogout);

// Protected Admin Routes
router.use(isAuthenticated);

router.get('/dashboard', adminController.getDashboard);

// Bulletins
router.get('/bulletins', adminController.getBulletins);
router.get('/bulletins/create', adminController.getCreateBulletin);
router.post('/bulletins/create', upload.single('photo'), adminController.postCreateBulletin);
router.get('/bulletins/:id/edit', adminController.getEditBulletin);
router.post('/bulletins/:id/edit', upload.single('photo'), adminController.postEditBulletin);
router.post('/bulletins/:id/delete', adminController.deleteBulletin);

// Tips
router.get('/tips', adminController.getTips);
router.post('/tips/:id/update', adminController.updateTip);
router.get('/api/unread-tips', adminController.getUnreadTipsCount);

// Map
router.get('/map', adminController.getMap);
router.post('/map/add', adminController.postMapPoint);
router.post('/map/:id/delete', adminController.deleteMapPoint);
router.post('/map/bulk-add', adminController.bulkAddMapPoints);
router.post('/map/purge-placeholders', adminController.purgePlaceholders);

// Intelligence Reports
router.get('/reports', adminController.getReports);
router.post('/reports/extract', memoryUpload.single('file'), adminController.processAIExtraction);
router.post('/process-ai', memoryUpload.single('file'), adminController.processAIExtraction);
router.post('/reports/save', adminController.saveReportBatch);
router.post('/reports/:id/delete', adminController.deleteReport);

// Hotlines
router.get('/hotlines', adminController.getHotlines);
router.post('/hotlines/add', adminController.postHotline);
router.post('/hotlines/:id/delete', adminController.deleteHotline);

// Superadmin Only
router.get('/users', isSuperAdmin, adminController.getUsers);
router.post('/users/add', isSuperAdmin, adminController.postUser);
router.get('/audit-log', isSuperAdmin, adminController.getAuditLog);

export default router;
