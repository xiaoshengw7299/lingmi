import { BadRequestException, Body, Controller, Get, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthUser } from '../../common/types/auth-user';
import { RequireBalance } from '../billing/require-balance';
import { GenerateDto, ImageToolDto } from './generation.dto';
import { ImageToolsService } from './image-tools.service';
import { GenerationService } from './generation.service';

const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

/** 通用生成：创建任务后立即返回 taskId，前端轮询 GET /generate/:id 取结果 */
@Controller('generate')
export class GenerationController {
  constructor(
    private readonly generation: GenerationService,
    private readonly imageTools: ImageToolsService,
  ) {}

  @Public()
  @Get('models')
  models() {
    return this.generation.listModels();
  }

  @Post()
  @RequireBalance()
  create(@Body() dto: GenerateDto, @CurrentUser() user: AuthUser) {
    return this.generation.create(String(user.userId), dto);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 } }))
  upload(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) {
    if (!file) throw new BadRequestException('请选择要上传的文件');
    return this.generation.upload(String(user.userId), file);
  }

  /** 图片小工具：裁剪 / 拆分 / 放大 / 局部重绘标注，同步返回处理后的图片 */
  @Post('image-tools')
  imageToolsRun(@Body() dto: ImageToolDto, @CurrentUser() user: AuthUser) {
    return this.imageTools.run(String(user.userId), dto);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.generation.get(String(user.userId), id);
  }
}
