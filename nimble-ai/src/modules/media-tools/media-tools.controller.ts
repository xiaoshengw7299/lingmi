import { Body, Controller, Delete, Get, HttpCode, Logger, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthUser } from '../../common/types/auth-user';
import { RequireBalance } from '../billing/require-balance';
import { CloneGenerateDto, ListToolTasksDto, RunToolDto } from './media-tools.dto';
import { MediaToolsService } from './media-tools.service';

/** 视频工具 / 通用工具。文件由浏览器直传 MediaKit，这里只收文件 ID 和参数 */
@Controller('media-tools')
export class MediaToolsController {
  constructor(private readonly tools: MediaToolsService) {}

  @Public()
  @Get('catalog')
  catalog() {
    return this.tools.catalog();
  }

  @Post('upload-url')
  uploadUrl(@CurrentUser() user: AuthUser) {
    return this.tools.uploadUrl(String(user.userId));
  }

  @Post('quote')
  quote(@Body() dto: RunToolDto, @CurrentUser() user: AuthUser) {
    return this.tools.quote(String(user.userId), dto);
  }

  @Post('tasks')
  @RequireBalance()
  create(@Body() dto: RunToolDto, @CurrentUser() user: AuthUser) {
    return this.tools.create(String(user.userId), dto);
  }

  @Get('tasks')
  list(@Query() query: ListToolTasksDto, @CurrentUser() user: AuthUser) {
    return this.tools.list(String(user.userId), query);
  }

  @Get('tasks/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tools.get(String(user.userId), id);
  }

  @Delete('tasks/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tools.remove(String(user.userId), id);
  }

  @Post('tasks/:id/generate')
  @RequireBalance()
  cloneGenerate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloneGenerateDto, @CurrentUser() user: AuthUser) {
    return this.tools.cloneGenerate(String(user.userId), id, dto);
  }

  @Post('tasks/:id/refs')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  uploadRef(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) {
    return this.tools.uploadRef(String(user.userId), id, file);
  }
}

/**
 * MediaKit 任务完成回调：`POST /api/webhooks/mediakit`。
 * 回调不带签名，只取任务 ID 触发一次回查，结果以查询接口为准，伪造回调改不了任何数据。
 */
@Public()
@Controller('webhooks/mediakit')
export class MediaKitWebhookController {
  private readonly logger = new Logger(MediaKitWebhookController.name);

  constructor(private readonly tools: MediaToolsService) {}

  @Post()
  @HttpCode(200)
  handle(@Body() body: { TaskId?: string; Data?: { TaskId?: string } }) {
    const taskId = body?.TaskId ?? body?.Data?.TaskId;
    if (taskId) {
      void this.tools.onCallback(String(taskId)).catch((error) => this.logger.warn(`MediaKit 回调处理失败 task=${taskId}：${error instanceof Error ? error.message : error}`));
    }
    return 'ok';
  }
}
