import 'express-session';

declare module 'express-session' {
  interface SessionData {
    user: any;
    publicUser?: any;
    hideSidebar?: boolean;
    language?: string;
    success_msg?: string;
    error_msg?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      lang?: string;
    }
  }
}
