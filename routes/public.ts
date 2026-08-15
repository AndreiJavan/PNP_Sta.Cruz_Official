import { Router } from 'express';
import * as publicController from '../controllers/publicController.js';

const router = Router();

router.get('/', publicController.getHome);
router.get('/map', publicController.getMap);
router.get('/api/map-points', publicController.getMapPoints);
router.get('/wanted-persons', publicController.getWantedPersons);
router.get('/missing-persons', publicController.getMissingPersons);
router.get('/bulletins', publicController.getBulletins);
router.get('/bulletins/:id', publicController.getBulletinDetail);

router.get('/about', publicController.getAbout);
router.get('/hotlines', publicController.getHotlines);
router.get('/news', publicController.getNews);
router.post('/api/translate-tagalog', publicController.translateToTagalog);
<<<<<<< HEAD
router.post('/api/user/language', publicController.postSetLanguage);
=======
router.post('/api/chat-article', publicController.chatWithArticle);
>>>>>>> e8cf233dd2a920677212887eeb59fb9502f3098b

export default router;
