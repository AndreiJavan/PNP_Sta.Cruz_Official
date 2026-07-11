import { Router } from 'express';
import * as publicController from '../controllers/publicController.js';

const router = Router();

router.get('/', publicController.getHome);
router.get('/map', publicController.getMap);
router.get('/api/map-points', publicController.getMapPoints);
router.get('/wanted-persons', publicController.getWantedPersons);
router.get('/missing-persons', publicController.getMissingPersons);
router.get('/bulletins/:id', publicController.getBulletinDetail);

router.get('/about', publicController.getAbout);
router.get('/hotlines', publicController.getHotlines);
router.get('/bulletins', publicController.getBulletins);

export default router;
