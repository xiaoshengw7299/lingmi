import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from './entities/system-config.entity';

@Injectable()
export class SystemConfigService implements OnModuleInit {
  constructor(@InjectRepository(SystemConfig) private readonly config: Repository<SystemConfig>) {}

  async onModuleInit() {
    await this.config.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['system-config-schema']);
      await manager.query(`CREATE TABLE IF NOT EXISTS system_config (
        key varchar(100) PRIMARY KEY,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    });
  }

  async get<T extends object>(key: string): Promise<T | null> {
    const row = await this.config.findOneBy({ key });
    return (row?.value as T | undefined) ?? null;
  }

  async set(key: string, value: object): Promise<void> {
    await this.config.upsert({ key, value }, ['key']);
  }
}
