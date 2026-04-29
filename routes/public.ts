import { Router } from 'express';
import * as publicController from '../controllers/publicController.js';
import { isPublicAuthenticated } from '../middleware/publicAuth.js';
import upload from '../middleware/upload.js';

const router = Router();

router.get('/', publicController.getHome);
router.get('/map', publicController.getMap);
router.get('/api/map-points', publicController.getMapPoints);
router.get('/bulletins', publicController.getBulletins);
router.get('/bulletins/:id', publicController.getBulletinDetail);

router.get('/login', publicController.getLogin);
router.post('/login', publicController.postLogin);
router.get('/register', publicController.getRegister);
router.post('/register', upload.single('government_id'), publicController.postRegister);
router.get('/logout', publicController.getLogout);

router.get('/tip', isPublicAuthenticated, publicController.getTip);
router.post('/tip', isPublicAuthenticated, publicController.postTip);
router.get('/about', publicController.getAbout);
router.get('/hotlines', publicController.getHotlines);

export default router;
