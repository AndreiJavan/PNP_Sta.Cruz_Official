import { Router } from 'express';
import * as publicController from '../controllers/publicController.js';

const router = Router();

router.get('/', publicController.getHome);
router.get('/map', publicController.getMap);
router.get('/api/map-points', publicController.getMapPoints);
router.get('/bulletins', publicController.getBulletins);
router.get('/bulletins/:id', publicController.getBulletinDetail);

router.get('/about', publicController.getAbout);
router.get('/hotlines', publicController.getHotlines);

export default router;
