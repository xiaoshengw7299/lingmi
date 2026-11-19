import { Injectable } from '@nestjs/common';
import { AtlasModelRegistryService } from '../../atlas/atlas-model-registry.service';

export interface AvailableLlmModel {
  id: string;
  name: string;
  isDefault: boolean;
}

/**
 * 智能体可选 LLM：清单与默认模型都来自 config/atlas-models.json 的 llm 分组。
 * 请求里的未知/历史旧 id 在解析时回退为默认模型，避免历史会话直接 400。
 */
@Injectable()
export class ModelPolicyService {
  constructor(private readonly models: AtlasModelRegistryService) {}

  get defaultModelId(): string {
    return this.models.resolveTextModel('llm').id;
  }

  /** 解析为当前配置中的 llm id；未传或已失效则回退默认模型 */
  resolve(modelId?: string | null): string {
    return this.models.resolveTextModel('llm', modelId).id;
  }

  list(): AvailableLlmModel[] {
    const defaultId = this.defaultModelId;
    return this.models.listTextModels('llm').map((item) => ({
      id: item.id,
      name: item.name,
      isDefault: item.id === defaultId,
    }));
  }
}
