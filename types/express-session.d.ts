import 'express-session';

declare module 'express-session' {
  interface SessionData {
    user: any;
    success_msg: string;
    error_msg: string;
  }
}
