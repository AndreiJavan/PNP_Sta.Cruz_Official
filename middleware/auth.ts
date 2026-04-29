import { Request, Response, NextFunction } from 'express';

export const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/admin/login');
};

export const isSuperAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.session && req.session.user && req.session.user.role === 'superadmin') {
    return next();
  }
  req.session.error_msg = 'Access denied. Superadmin only.';
  res.redirect('/admin/dashboard');
};
