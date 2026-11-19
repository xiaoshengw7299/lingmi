import { Global, Module } from '@nestjs/common';
import { EngagementService } from './engagement.service';

/** 浏览/复制计数，提示词库与案例库共用 */
@Global()
@Module({ providers: [EngagementService], exports: [EngagementService] })
export class EngagementModule {}
