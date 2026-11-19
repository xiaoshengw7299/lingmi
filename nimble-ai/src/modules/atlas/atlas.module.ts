import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AtlasClientService } from './atlas-client.service';
import { AtlasModelRegistryService } from './atlas-model-registry.service';
import { AtlasLlmService } from './atlas-llm.service';
import { AtlasInflightReconciler } from './atlas-inflight.reconciler';
import { AtlasWebhookController } from './atlas-webhook.controller';
import { AtlasWebhookDispatcherService } from './atlas-webhook-dispatcher.service';
import { AtlasWebhookVerifierService } from './atlas-webhook-verifier.service';

/**
 * 模型平台API 模型层：全项目统一的图片/视频/音频/LLM/视觉理解生成入口。
 *
 * 全局模块（同 StorageModule），video-producer / 一键成片 / 智能体聊天等业务模块
 * 直接注入 AtlasClientService + AtlasModelRegistryService（图片/视频/音频）或
 * AtlasLlmService（文案/视觉理解/对话）即可调用，无需重复声明 provider。
 * 可选模型清单见 config/atlas-models.json。
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [AtlasWebhookController],
  providers: [
    AtlasClientService,
    AtlasModelRegistryService,
    AtlasLlmService,
    AtlasWebhookVerifierService,
    AtlasWebhookDispatcherService,
    AtlasInflightReconciler,
  ],
  exports: [AtlasClientService, AtlasModelRegistryService, AtlasLlmService, AtlasWebhookDispatcherService],
})
export class AtlasModule {}
