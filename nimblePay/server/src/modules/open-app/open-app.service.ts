import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DEFAULT_APP_SECRET, NIMBLE_APP_ID } from '../../common/constants';
import { SecretService } from '../../common/crypto/secret.service';
import { OpenApp } from '../../entities';

@Injectable()
export class OpenAppService {
  private cached: OpenApp | null = null;

  constructor(
    @InjectRepository(OpenApp) private readonly apps: Repository<OpenApp>,
    private readonly secrets: SecretService,
    private readonly config: ConfigService,
  ) {}

  appSecret() {
    return this.config.get<string>('NIMBLE_APP_SECRET')?.trim() || DEFAULT_APP_SECRET;
  }

  appId() {
    return this.config.get<string>('NIMBLE_APP_ID')?.trim() || NIMBLE_APP_ID;
  }

  async ensure() {
    if (this.cached?.status === 'ACTIVE') {
      try {
        if (this.secrets.decrypt(this.cached.secretEnc) === this.appSecret()) return this.cached;
      } catch {
        this.cached = null;
      }
    }
    const row = await this.apps.findOne({ where: { appId: this.appId(), status: 'ACTIVE' } });
    if (!row) throw new Error('开放应用未初始化');
    this.cached = row;
    return row;
  }
}
