export {};

declare global {
  namespace Express {
    interface Request {
      rawBody?: string;
      admin?: {
        id: string;
        username: string;
        isSuperAdmin: boolean;
        permissions: string[];
      };
      openApp?: { id: string; appId: string; appName: string };
      member?: { id: string; username: string; appId: string };
    }
  }
}
