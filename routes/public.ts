import { Router } from 'express';
import * as publicController from '../controllers/publicController.js';
import * as publicAuthController from '../controllers/publicAuthController.js';

const router = Router();

router.get('/', publicController.getHome);
router.get('/map', publicController.getMap);
router.get('/api/map-points', publicController.getMapPoints);
router.get('/bulletins', publicController.getBulletins);
router.get('/bulletins/:id', publicController.getBulletinDetail);
router.get('/login', publicAuthController.getLogin);
router.post('/login', publicAuthController.postLogin);
router.get('/register', publicAuthController.getRegister);
router.post('/register', publicAuthController.postRegister);
router.get('/logout', publicAuthController.getLogout);

const requirePublicAuth = (req: any, res: any, next: any) => {
    if (req.session && req.session.user && req.session.user.role === 'public') {
        return next();
    }
    res.redirect('/login?redirect=/tip');
};

router.get('/tip', requirePublicAuth, publicController.getTip);
router.post('/tip', requirePublicAuth, publicController.postTip);
router.get('/about', publicController.getAbout);
router.get('/hotlines', publicController.getHotlines);

export default router;
