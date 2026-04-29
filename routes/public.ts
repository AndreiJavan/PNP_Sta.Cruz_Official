import { Router } from 'express';
import * as publicController from '../controllers/publicController.js';
import { isPublicAuthenticated } from '../middleware/publicAuth.js';
import multer from 'multer';

const router = Router();
const memoryUpload = multer({ storage: multer.memoryStorage() });

router.get('/', publicController.getHome);
router.get('/map', publicController.getMap);
router.get('/api/map-points', publicController.getMapPoints);
router.get('/bulletins', publicController.getBulletins);
router.get('/bulletins/:id', publicController.getBulletinDetail);

router.get('/login', publicController.getLogin);
router.post('/login', publicController.postLogin);
router.get('/register', publicController.getRegister);
router.post('/register', memoryUpload.single('government_id'), publicController.postRegister);
router.get('/logout', publicController.getLogout);

router.get('/tip', isPublicAuthenticated, publicController.getTip);
router.post('/tip', isPublicAuthenticated, publicController.postTip);
router.get('/about', publicController.getAbout);
router.get('/hotlines', publicController.getHotlines);

export default router;
