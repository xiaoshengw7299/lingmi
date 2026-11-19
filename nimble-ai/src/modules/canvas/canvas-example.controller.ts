import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthUser } from '../../common/types/auth-user';
import { viewerOf } from '../engagement/engagement.service';
import { CanvasExampleService } from './canvas-example.service';

class QueryCanvasExampleDto {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
  @IsOptional() @IsIn(['hot', 'new']) sort?: 'hot' | 'new';
}

class ShareCanvasDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string;
}

/** 分享的画布作品：与工作台案例并列出现在创作首页 */
@Controller('canvas-examples')
export class CanvasExampleController {
  constructor(private readonly examples: CanvasExampleService) {}

  @Public()
  @Get()
  list(@Query() query: QueryCanvasExampleDto) {
    return this.examples.list(query);
  }

  @Public()
  @Get(':id')
  get(@Param('id') id: string) {
    return this.examples.get(id);
  }

  @Public()
  @Post(':id/view')
  view(@Param('id') id: string, @Req() req: Request) {
    return this.examples.viewed(id, viewerOf(req));
  }

  @Post('from-canvas/:canvasId')
  share(@Param('canvasId') canvasId: string, @Body() dto: ShareCanvasDto, @CurrentUser() user: AuthUser) {
    return this.examples.publish(user, canvasId, dto.title);
  }

  @Post(':id/use')
  use(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.examples.use(user, id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.examples.remove(user, id);
  }
}
