import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptAesGcm, encryptAesGcm } from './crypto.util';

@Injectable()
export class SecretService {
  private readonly key: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('ENCRYPTION_KEY', '');
    if (!/^[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error('ENCRYPTION_KEY 必须是 32 字节的 hex（64 个字符）');
    }
    this.key = key;
  }

  encrypt(plain: string): string {
    return encryptAesGcm(plain, this.key);
  }

  decrypt(payload: string): string {
    if (!payload) return '';
    return decryptAesGcm(payload, this.key);
  }
}
