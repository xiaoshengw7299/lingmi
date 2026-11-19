import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { viewerOf } from '../engagement/engagement.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { toClientModel } from '../atlas/atlas.types';
import { VideoService, UploadedFileDto, ASSET_UPLOAD_MAX_BYTES } from './video.service';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireBalance } from '../billing/require-balance';
import { AuthUser, displayName } from '../../common/types/auth-user';
import {
  AddAssetDto,
  AddShotDto,
  BatchImageDto,
  BatchVideoDto,
  CreateBlankProjectDto,
  CreateExampleDto,
  GenerationModeDto,
  ImportAssetDto,
  QueryExampleDto,
  QueryProjectDto,
  ReorderAssetsDto,
  ReorderShotsDto,
  UpdateAssetDto,
  UpdateProjectTitleDto,
  UpdateShotDto,
  UseExampleDto,
} from './dto/video.dto';

/**
 * 视频制作控制器
 *
 * 分镜脚本本身由对话中的 generate_storyboard 工具创建（见 agent/tools/video），
 * 此控制器只负责脚本生成之后的工作台操作：素材库/分镜编辑、生成图片/视频、成片合成。
 * 生成/合成类接口均立即返回（后台异步执行），最终结果通过 Socket.IO 推送。
 */
@Controller('video')
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  private access(user: AuthUser) {
    return { userId: String(user.userId), isAdmin: !!user.isAdmin };
  }

  private async guardProject(id: string, user: AuthUser) {
    const { userId, isAdmin } = this.access(user);
    await this.videoService.assertCanAccessProject(id, userId, isAdmin);
  }

  /** 图片/视频当前各自可选的 模型平台API 模型列表（含默认模型标记、时长与参考能力），供前端下拉框使用 */
  @Public()
  @Get('models')
  async listModels() {
    const [image, video] = await Promise.all([
      this.videoService.listModels('image'),
      this.videoService.listModels('video'),
    ]);
    return { image: image.map(toClientModel), video: video.map(toClientModel) };
  }

  @Get('projects')
  listProjects(@Query() query: QueryProjectDto, @CurrentUser() user: AuthUser) {
    return this.videoService.listProjects({ ...query, userId: String(user.userId) });
  }

  @Get('projects/:id')
  getProject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const { userId, isAdmin } = this.access(user);
    return this.videoService.getProjectForUser(id, userId, isAdmin);
  }

  /** 新会话首页"空白工作台"：跳过对话生成分镜的过程，直接创建空项目 */
  @Post('projects')
  createBlankProject(@Body() dto: CreateBlankProjectDto, @CurrentUser() user: AuthUser) {
    return this.videoService.createBlankProject({ ...dto, userId: String(user.userId) });
  }

  @Post('projects/:id/shots')
  async addShot(@Param('id') id: string, @Body() dto: AddShotDto, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.addShot(id, dto);
  }

  @Patch('projects/:id/shots/reorder')
  async reorderShots(@Param('id') id: string, @Body() dto: ReorderShotsDto, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.reorderShots(id, dto.shotIds);
  }

  @Patch('projects/:id/shots/:shotId')
  async updateShot(
    @Param('id') id: string,
    @Param('shotId') shotId: string,
    @Body() dto: UpdateShotDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.guardProject(id, user);
    return this.videoService.updateShot(id, shotId, dto);
  }

  @Delete('projects/:id/shots/:shotId')
  async deleteShot(@Param('id') id: string, @Param('shotId') shotId: string, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.archiveShot(id, shotId);
  }

  @Post('projects/:id/shots/:shotId/takes/:takeId/select')
  async selectTake(
    @Param('id') id: string,
    @Param('shotId') shotId: string,
    @Param('takeId') takeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.guardProject(id, user);
    return this.videoService.selectTake(id, shotId, takeId);
  }

  @Patch('projects/:id/settings')
  async updateSettings(@Param('id') id: string, @Body() dto: GenerationModeDto, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.updateProjectSettings(id, dto.generationMode);
  }

  @Patch('projects/:id/title')
  async updateTitle(@Param('id') id: string, @Body() dto: UpdateProjectTitleDto, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.updateProjectTitle(id, dto.title);
  }

  /** 项目级素材上传（图片/视频/音频）：直接加入素材库，供提示词通过 @名称 引用。 */
  @Post('projects/:id/local-uploads')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ASSET_UPLOAD_MAX_BYTES, files: 1 } }))
  async uploadLocalRef(
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('请选择要上传的素材文件');
    await this.guardProject(id, user);
    return this.videoService.uploadLocalRef(id, file);
  }

  /** 从「我的资产」引用媒体到项目素材库 */
  @Post('projects/:id/asset-imports')
  async importAsset(@Param('id') id: string, @Body() dto: ImportAssetDto, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.importAssetFromUrl(id, String(user.userId), dto);
  }

  // ─── 素材库 ──────────────────────────────────────────────
  @Post('projects/:id/assets')
  async addAsset(@Param('id') id: string, @Body() dto: AddAssetDto, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.addAsset(id, dto);
  }

  @Patch('projects/:id/assets/reorder')
  async reorderAssets(@Param('id') id: string, @Body() dto: ReorderAssetsDto, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.reorderAssets(id, dto.assetIds);
  }

  @Post('projects/:id/assets/images/batch')
  @RequireBalance()
  async generateAllAssetImages(
    @Param('id') id: string,
    @Body() dto: BatchImageDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.guardProject(id, user);
    return this.videoService.generateAllAssetImages(id, dto.assetIds);
  }

  /** 停止排队和正在生成的参考图，并退回已扣费用 */
  @Post('projects/:id/assets/images/cancel')
  async cancelAssetImages(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.cancelQueuedAssetImages(id);
  }

  @Patch('projects/:id/assets/:refId')
  async updateAsset(
    @Param('id') id: string,
    @Param('refId') refId: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.guardProject(id, user);
    return this.videoService.updateAsset(id, refId, dto);
  }

  @Delete('projects/:id/assets/:refId')
  async deleteAsset(@Param('id') id: string, @Param('refId') refId: string, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.deleteAsset(id, refId);
  }

  @Post('projects/:id/assets/:refId/image')
  @RequireBalance()
  async generateAssetImage(@Param('id') id: string, @Param('refId') refId: string, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.generateAssetImage(id, refId);
  }

  @Post('projects/:id/assets/:refId/text')
  @RequireBalance()
  async generateAssetText(@Param('id') id: string, @Param('refId') refId: string, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.generateAssetText(id, refId);
  }

  /** 替换"本地上传"素材的文件（保持名称/提示词/@ 引用不变，须与原素材同类型） */
  @Post('projects/:id/assets/:refId/replace-file')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ASSET_UPLOAD_MAX_BYTES, files: 1 } }))
  async replaceAssetFile(
    @Param('id') id: string,
    @Param('refId') refId: string,
    @UploadedFile() file: UploadedFileDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('请选择要上传的素材文件');
    await this.guardProject(id, user);
    return this.videoService.replaceAssetFile(id, refId, file);
  }

  // ─── 分镜视频生成 + 合成 ─────────────────────────────────
  @Post('projects/:id/shots/:shotId/video')
  @RequireBalance()
  async generateShotVideo(@Param('id') id: string, @Param('shotId') shotId: string, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.generateShotVideo(id, shotId);
  }

  @Post('projects/:id/videos/batch')
  @RequireBalance()
  async generateAllShotVideos(@Param('id') id: string, @Body() dto: BatchVideoDto, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.generateAllShotVideos(id, dto.shotIds, dto.mode);
  }

  /** 停止排队和正在生成的分镜视频，并退回已扣费用 */
  @Post('projects/:id/videos/cancel')
  async cancelShotVideos(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.cancelQueuedShotVideos(id);
  }

  @Post('projects/:id/compose')
  async composeProject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.composeProject(id);
  }

  // ─── 生成经验 ─────────────────────────────────────────────
  /** 汇总项目全流程生成一份 Markdown 制作经验，前端直接触发下载，不落库 */
  @Post('projects/:id/experience')
  async generateExperience(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    const markdown = await this.videoService.generateExperience(id);
    return { markdown };
  }

  // ─── 生成示例（案例库） ───────────────────────────────────
  @Public()
  @Get('examples')
  listExamples(@Query() query: QueryExampleDto) {
    return this.videoService.listExamples(query);
  }

  /** 打开案例预览时调用，计入查看数（同一用户一天一次） */
  @Public()
  @Post('examples/:id/view')
  viewExample(@Param('id') id: string, @Req() req: Request) {
    return this.videoService.viewExample(id, viewerOf(req));
  }

  /** 这个作品被他人复制的奖励进度，作者在工作台查看 */
  @Get('examples/:id/share-reward')
  shareReward(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.videoService.shareRewardStatus(id, user.userId);
  }

  @Public()
  @Get('examples/:id')
  getExample(@Param('id') id: string) {
    return this.videoService.getExample(id);
  }

  @Post('projects/:id/examples')
  async createExample(@Param('id') id: string, @Body() dto: CreateExampleDto, @CurrentUser() user: AuthUser) {
    await this.guardProject(id, user);
    return this.videoService.createExample(id, {
      title: dto.title,
      userId: String(user.userId),
      userName: displayName(user),
    });
  }

  @Post('examples/:id/use')
  useExample(@Param('id') id: string, @Body() dto: UseExampleDto, @CurrentUser() user: AuthUser) {
    return this.videoService.useExample(id, {
      sessionId: dto.sessionId,
      userId: String(user.userId),
    });
  }

  @Delete('examples/:id')
  deleteExample(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.videoService.deleteExample(id, String(user.userId), !!user.isAdmin);
  }
}
