import { Router } from 'express';
import {
  getLogin, postLogin, getLogout, getDashboard, getBulletins, getCreateBulletin,
  postCreateBulletin, getEditBulletin, postEditBulletin, deleteBulletin, getTips, getUnreadTipsCount,
  updateTip, getMap, postMapPoint, deleteMapPoint, bulkAddMapPoints, purgePlaceholders,
  getReports, processAIExtraction, saveReportBatch, deleteReport, getHotlines,
  postHotline, deleteHotline, getUsers, postUser, deleteUser
} from '../controllers/adminController.js';
import { isAuthenticated } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import multer from 'multer';

const router = Router();
const memoryUpload = multer({ storage: multer.memoryStorage() });

// Public Admin Routes
router.get('/login', getLogin);
router.post('/login', postLogin);
router.get('/logout', getLogout);

// Protected Admin Routes
router.use(isAuthenticated);

router.get('/dashboard', getDashboard);

// Bulletins
router.get('/bulletins', getBulletins);
router.get('/bulletins/create', getCreateBulletin);
router.post('/bulletins/create', memoryUpload.single('photo'), postCreateBulletin);
router.get('/bulletins/:id/edit', getEditBulletin);
router.post('/bulletins/:id/edit', memoryUpload.single('photo'), postEditBulletin);
router.post('/bulletins/:id/delete', deleteBulletin);

// Tips
router.get('/tips', getTips);
router.get('/api/unread-tips', getUnreadTipsCount);
router.post('/tips/:id/update', updateTip);

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
router.post('/hotlines/:id/delete', deleteHotline);

// Personnel Management
router.get('/users', getUsers);
router.post('/users/add', postUser);
router.post('/users/:id/delete', deleteUser);

export default router;
