import { Request, Response, NextFunction } from 'express';
import { verifyAuthToken } from '../utils/authToken.js';

export const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
  // 1. Direct session check
  if (req.session && req.session.user) {
    return next();
  }

  // 2. Token-backed session restoration (survives serverless cold starts & multi-instances)
  const token = req.cookies?.stacruz_auth;
  if (token) {
    const verifiedUser = verifyAuthToken(token);
    if (verifiedUser) {
      if (req.session) {
        req.session.user = verifiedUser;
        (req.session as any).hideSidebar = (req.session as any).hideSidebar ?? true;
      }
      return next();
    }
  }

  // Detect if request is genuinely an AJAX/API/JSON request
  const isApiRequest = 
    req.xhr ||
    req.headers['x-requested-with'] === 'XMLHttpRequest' ||
    Boolean(req.headers.accept && req.headers.accept.includes('application/json')) ||
    req.path.startsWith('/api') ||
    req.originalUrl.includes('/api/') ||
    req.originalUrl.startsWith('/admin/api');

  console.warn(`[AUTH PROTECT] Session invalid/missing. URL: ${req.originalUrl || req.url}, Method: ${req.method}, IsAPI: ${isApiRequest}`);

  // Clear stale auth cookie if invalid
  res.clearCookie('stacruz_auth', { path: '/' });

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
  let user = req.session?.user;

  if (!user && req.cookies?.stacruz_auth) {
    const verifiedUser = verifyAuthToken(req.cookies.stacruz_auth);
    if (verifiedUser) {
      user = verifiedUser;
      if (req.session) {
        req.session.user = verifiedUser;
      }
    }
  }

  if (user && user.role === 'superadmin') {
    return next();
  }

  const isApiRequest = 
    req.xhr ||
    req.headers['x-requested-with'] === 'XMLHttpRequest' ||
    Boolean(req.headers.accept && req.headers.accept.includes('application/json')) ||
    req.path.startsWith('/api') ||
    req.originalUrl.includes('/api/') ||
    req.originalUrl.startsWith('/admin/api');

  if (isApiRequest) {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Superadmin only.'
    });
  }

  req.session.error_msg = 'Access denied. Superadmin only.';
  if (req.session) {
    req.session.error_msg = 'Access denied. Superadmin only.';
  }
  res.redirect('/admin/dashboard');
};
