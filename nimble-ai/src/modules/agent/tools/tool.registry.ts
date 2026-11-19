import { Injectable, Logger } from '@nestjs/common';
import { tool } from 'ai';
import { ToolDef, ToolExecuteCtx, ToolResult, ToolServices } from './tool.define';

/** 请求级工具过滤条件 */
export interface ToolFilter {
  /**
   * 按工具分组（ToolDef.tag）过滤（未打 tag 的内置工具始终加载，不受此参数影响）
   * - 不传（undefined）= 默认加载全部可选工具组
   * - 传了（含空数组）= 仅加载数组内列出的分组，空数组表示不加载任何可选工具
   */
  toolGroups?: string[];
}

/**
 * 统一工具注册中心
 *
 * 设计原则：
 * - 一个工具 = 一个 ToolDef 对象，工具文件由 tools/index.ts 自动扫描注册（无需手动登记）
 * - 无 tag 字段 = 内置工具，始终加载（如 read/memory/skill_manage）
 * - 有 tag 字段 = 可选工具组，按请求 toolGroups 过滤（如 generate_storyboard 属于 video_gen）
 *   同一 tag 下的多个工具会被一次性放开
 * - toolGroups 未传（undefined）= 默认加载全部可选工具；传了（含空数组）= 仅加载数组内的分组
 * - setServices() 注入 NestJS 服务，execute() 时透传给工具上下文
 * - buildAISDKTools() 直接输出 AI SDK tool() 对象（Zod schema，无需 jsonSchema() 包装）
 */
@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly tools = new Map<string, ToolDef>();
  private services: ToolServices = {};

  /** 注入可用服务（由 AgentModule 在 onModuleInit 中调用） */
  setServices(services: ToolServices) {
    this.services = services;
  }

  /** 注册单个工具 */
  register(toolDef: ToolDef) {
    if (this.tools.has(toolDef.name)) {
      this.logger.warn(`Tool overwritten: ${toolDef.name}`);
    }
    this.tools.set(toolDef.name, toolDef);
    this.logger.log(`Registered tool: ${toolDef.name}${toolDef.tag ? ` [${toolDef.tag}]` : ''}`);
  }

  /** 批量注册 */
  registerAll(toolDefs: ToolDef[]) {
    toolDefs.forEach((t) => this.register(t));
  }

  /**
   * 根据请求过滤条件获取可用工具列表
   *
   * 过滤规则：
   * - 无 tag 字段（内置工具）：始终加载
   * - 有 tag 字段：toolGroups 未传（undefined）= 默认全部放开；传了 = 仅放开数组内的 tag
   */
  getForRequest(toolGroups?: string[]): ToolDef[] {
    return Array.from(this.tools.values()).filter((def) => {
      if (!def.tag) return true;
      if (toolGroups === undefined) return true;
      return toolGroups.includes(def.tag);
    });
  }

  /** 获取所有工具 */
  getAll(): ToolDef[] {
    return Array.from(this.tools.values());
  }

  /**
   * 构建 AI SDK tool() 对象集合（供 streamText/generateText 使用）
   *
   * 工具的 execute 函数通过闭包绑定 context 和 services，
   * 调用方（AgentService）可进一步包装以添加去重、SSE 推送等逻辑。
   */
  buildAISDKTools(
    filter: ToolFilter,
    executeWrapper: (name: string, showProgress: boolean, args: any) => Promise<string>,
  ): Record<string, any> {
    const toolDefs = this.getForRequest(filter.toolGroups);
    const result: Record<string, any> = {};

    for (const def of toolDefs) {
      const showProgress = def.showProgress ?? !!def.tag;
      result[def.name] = tool({
        description: def.description,
        inputSchema: def.parameters,
        execute: (args: any) => executeWrapper(def.name, showProgress, args),
      });
    }

    return result;
  }

  /** 执行工具（透传 services） */
  async execute(name: string, args: Record<string, any>, ctx: ToolExecuteCtx): Promise<ToolResult> {
    const def = this.tools.get(name);
    if (!def) {
      return { success: false, output: `Tool not found: ${name}`, error: `Tool not found: ${name}` };
    }

    try {
      return await def.execute(args, { ...ctx, services: this.services });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Tool execution error: ${name}`, error instanceof Error ? error.stack : msg);
      return { success: false, output: `Tool execution failed: ${msg}`, error: msg };
    }
  }

  /** 获取工具展示名 */
  getTitle(name: string): string {
    return this.tools.get(name)?.title || name;
  }

  /** 工具是否存在 */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }
}
