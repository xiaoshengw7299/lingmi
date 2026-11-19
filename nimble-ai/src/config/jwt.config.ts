import { registerAs } from '@nestjs/config';

export default registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET || 'default-secret-change-me',
  accessExpires: process.env.JWT_ACCESS_EXPIRES || '2h',
  refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
}));
