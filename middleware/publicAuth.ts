import { Request, Response, NextFunction } from 'express';

export const isPublicAuthenticated = (req: Request, res: Response, next: NextFunction) => {
    if (req.session && req.session.publicUser) {
        return next();
    }
    res.redirect('/login');
};
