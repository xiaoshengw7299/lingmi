import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { viewerOf } from '../engagement/engagement.service';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthUser } from '../../common/types/auth-user';
import { CreatePromptDto, QueryPromptDto } from './prompt.dto';
import { PromptService } from './prompt.service';

@Controller('prompts')
export class PromptController {
  constructor(private readonly prompts: PromptService) {}

  @Public()
  @Get()
  list(@Query() query: QueryPromptDto) {
    return this.prompts.list(query);
  }

  @Public()
  @Get(':id')
  get(@Param('id') id: string) {
    return this.prompts.get(id);
  }

  @Post()
  create(@Body() dto: CreatePromptDto, @CurrentUser() user: AuthUser) {
    return this.prompts.create(user, dto);
  }

  /** 使用提示词：返回复制好的参考素材，前端据此搭好创作环境 */
  @Post(':id/use')
  use(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.prompts.use(id, user);
  }

  @Public()
  @Post(':id/view')
  view(@Param('id') id: string, @Req() req: Request) {
    return this.prompts.record(id, viewerOf(req), 'view');
  }

  @Public()
  @Post(':id/copy')
  copy(@Param('id') id: string, @Req() req: Request) {
    return this.prompts.record(id, viewerOf(req), 'copy');
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.prompts.remove(id, user);
  }
}
