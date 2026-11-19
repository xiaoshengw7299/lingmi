import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthUser } from '../../common/types/auth-user';
import {
  CreateShortVideoTaskDto,
  DownloadShortVideoDto,
  QueryShortVideoTaskDto,
  VoicePreviewDto,
  GenerateShortVideoScriptDto,
  PreviewShortVideoStockDto,
} from './dto/short-video.dto';
import { ShortVideoService, UploadedFileDto } from './short-video.service';
import { BGM_UPLOAD_MAX_BYTES, MATERIAL_UPLOAD_MAX_BYTES } from './short-video.options';
import { ShortVideoPricingService } from './short-video-pricing.service';

@Controller('short-video')
export class ShortVideoController {
  constructor(
    private readonly shortVideoService: ShortVideoService,
    private readonly pricing: ShortVideoPricingService,
  ) {}

  @Public()
  @Get('pricing')
  @Header('Cache-Control', 'no-store')
  getPricing() {
    return this.pricing.quote();
  }

  @Public()
  @Get('options')
  listOptions() {
    return this.shortVideoService.listOptions();
  }

  @Get('tasks')
  listTasks(@Query() query: QueryShortVideoTaskDto, @CurrentUser() user: AuthUser) {
    return this.shortVideoService.listTasks(String(user.userId), query);
  }

  @Get('tasks/:id/download-url')
  getDownloadUrl(
    @Param('id') id: string,
    @Query() query: DownloadShortVideoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.shortVideoService.getDownloadUrl(String(user.userId), id, query.index ?? 0);
  }

  @Get('tasks/:id')
  getTask(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.shortVideoService.getTask(String(user.userId), id);
  }

  @Post('tasks')
  createTask(@Body() dto: CreateShortVideoTaskDto, @CurrentUser() user: AuthUser) {
    return this.shortVideoService.createTask(String(user.userId), dto);
  }

  @Post('voice-preview')
  previewVoice(@Body() dto: VoicePreviewDto, @CurrentUser() user: AuthUser) {
    return this.pricing.runPreview(String(user.userId), dto.confirmedPricing, 0, () => this.shortVideoService.previewVoice(dto));
  }

  @Post('script')
  generateScript(@Body() dto: GenerateShortVideoScriptDto, @CurrentUser() user: AuthUser) {
    return this.pricing.runPreview(String(user.userId), dto.confirmedPricing, 1, () => this.shortVideoService.generateScriptPreview(dto));
  }

  @Post('stock-preview')
  previewStock(@Body() dto: PreviewShortVideoStockDto, @CurrentUser() user: AuthUser) {
    return this.pricing.runPreview(String(user.userId), dto.confirmedPricing, 1, () => this.shortVideoService.previewStock(dto));
  }

  /** 签名过的素材地址，给页面里的图片和视频标签直接打开 */
  @Public()
  @Get('stock-media')
  async streamStockMedia(
    @Query('u') u: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const upstream = await this.shortVideoService.openStockMedia(u, exp, sig, range);
    res.status(upstream.status);
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers[key];
      if (typeof value === 'string' || typeof value === 'number') res.setHeader(key, String(value));
      else if (Array.isArray(value)) res.setHeader(key, value.join(', '));
    }
    if (!res.getHeader('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    upstream.data.pipe(res);
    await new Promise<void>((resolve) => {
      upstream.data.on('end', () => resolve());
      upstream.data.on('error', () => resolve());
      res.on('close', () => resolve());
    });
  }

  @Post('tasks/:id/cancel')
  cancelTask(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.shortVideoService.cancelTask(String(user.userId), id);
  }

  @Delete('tasks/:id')
  deleteTask(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.shortVideoService.deleteTask(String(user.userId), id);
  }

  @Post('materials')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MATERIAL_UPLOAD_MAX_BYTES, files: 1 } }),
  )
  uploadMaterial(@UploadedFile() file: UploadedFileDto, @CurrentUser() user: AuthUser) {
    if (!file) throw new BadRequestException('请选择要上传的文件');
    return this.shortVideoService.uploadMaterial(String(user.userId), file);
  }

  @Post('bgm')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: BGM_UPLOAD_MAX_BYTES, files: 1 } }))
  uploadBgm(@UploadedFile() file: UploadedFileDto, @CurrentUser() user: AuthUser) {
    if (!file) throw new BadRequestException('请选择要上传的配乐');
    return this.shortVideoService.uploadBgm(String(user.userId), file);
  }
}
