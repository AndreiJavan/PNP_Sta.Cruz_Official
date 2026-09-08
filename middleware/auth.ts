import { Request, Response, NextFunction } from 'express';

export const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
  if (req.session && req.session.user) {
    return next();
  }

  // Detect if request is an AJAX/API/JSON request
  const isApiRequest = 
    req.xhr ||
    req.headers['x-requested-with'] === 'XMLHttpRequest' ||
    req.headers.accept?.includes('application/json') ||
    req.path.startsWith('/api') ||
    req.originalUrl.includes('/api/') ||
    req.originalUrl.startsWith('/admin/api') ||
    req.headers['sec-fetch-dest'] === 'empty';

  console.warn(`[AUTH PROTECT] Session invalid/missing. URL: ${req.originalUrl || req.url}, Method: ${req.method}, IsAPI: ${isApiRequest}`);

  if (isApiRequest) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized or session expired',
      expired: true
    });
  }

  res.redirect('/admin/login?expired=1');
};

export const isSuperAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.session && req.session.user && req.session.user.role === 'superadmin') {
    return next();
  }

  const isApiRequest = 
    req.xhr ||
    req.headers['x-requested-with'] === 'XMLHttpRequest' ||
    req.headers.accept?.includes('application/json') ||
    req.path.startsWith('/api') ||
    req.originalUrl.includes('/api/') ||
    req.originalUrl.startsWith('/admin/api') ||
    req.headers['sec-fetch-dest'] === 'empty';

  if (isApiRequest) {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Superadmin only.'
    });
  }

  req.session.error_msg = 'Access denied. Superadmin only.';
  res.redirect('/admin/dashboard');
};
