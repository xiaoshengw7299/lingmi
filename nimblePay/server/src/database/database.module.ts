import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from '../entities';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: String(config.get('DB_HOST', '127.0.0.1')),
        port: Number(config.get('DB_PORT', 5432)),
        username: String(config.get('DB_USERNAME', 'postgres')),
        password: String(config.get('DB_PASSWORD', 'postgres')),
        database: String(config.get('DB_DATABASE', 'nimblepay')),
        entities: ENTITIES,
        synchronize: config.get('NODE_ENV') !== 'production',
        logging: false,
      }),
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
