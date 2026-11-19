import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as path from 'path';

import { SessionEntity } from './entities/session.entity';
import { MessageEntity } from './entities/message.entity';

import { ModelPolicyService } from './providers';
import { ToolRegistry } from './tools/tool.registry';
import { allTools } from './tools';

import { VideoModule } from '../video/video.module';
import { VideoService } from '../video/video.service';
import { SkillLoader } from './skills/skill.loader';
import { AgentSpaceLoader, DEFAULT_AGENT_KEY } from './agent-space';
import { SystemPromptBuilder } from './prompt/system-prompt.builder';
import { AILoggerService } from './logger/ai-logger.service';
import { MemoryService } from './memory';
import { AtlasLlmService } from '../atlas/atlas-llm.service';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';

/**
 * Agent 模块
 * 工具统一使用 ToolRegistry：工具通过 defineTool() 定义，启动时自动扫描 tools 目录下的 *.tool.ts 注册
 * 智能体空间（人设）通过 AgentSpaceLoader 从 ai/agents/ 加载，当前只有「视频制作」一个空间
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SessionEntity, MessageEntity]),
    ConfigModule,
    VideoModule,
  ],
  controllers: [AgentController],
  providers: [
    ModelPolicyService,
    ToolRegistry,
    SkillLoader,
    AgentSpaceLoader,
    SystemPromptBuilder,
    AILoggerService,
    MemoryService,
    AgentService,
  ],
  exports: [AgentService, ToolRegistry, SkillLoader, MemoryService],
})
export class AgentModule implements OnModuleInit {
  private readonly logger = new Logger(AgentModule.name);

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly skillLoader: SkillLoader,
    private readonly agentSpaceLoader: AgentSpaceLoader,
    private readonly configService: ConfigService,
    private readonly atlasLlm: AtlasLlmService,
    private readonly memoryService: MemoryService,
    private readonly videoService: VideoService,
  ) {}

  async onModuleInit() {
    // 1. 注入服务（工具 execute 函数通过 ctx.services 访问）
    this.toolRegistry.setServices({
      model: this.atlasLlm.text(),
      memoryService: this.memoryService,
      skillLoader: this.skillLoader,
      videoService: this.videoService,
    });

    // 2. 注册所有工具（tools/ 目录自动扫描）
    this.toolRegistry.registerAll(allTools);
    this.logger.log(`Registered ${allTools.length} tools`);

    // 3. 加载技能
    const skillsDir = this.configService.get<string>(
      'SKILLS_DIR',
      path.join(process.cwd(), 'ai', 'skills'),
    );
    this.skillLoader.loadAll({ workspaceDir: skillsDir });

    // 4. 加载智能体空间（每个子目录一份人设配置，见 ai/agents/README.md）
    const agentsDir = this.configService.get<string>(
      'AGENT_SPACES_DIR',
      path.join(process.cwd(), 'ai', 'agents'),
    );
    this.agentSpaceLoader.loadAll({ dir: agentsDir, defaultKey: DEFAULT_AGENT_KEY });
  }
}
