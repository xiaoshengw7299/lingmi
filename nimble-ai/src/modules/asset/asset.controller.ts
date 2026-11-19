import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { AuthUser } from '../../common/types/auth-user';
import { CreateAssetDto, QueryAssetDto } from './asset.dto';
import { AssetService } from './asset.service';

const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

@Controller('assets')
export class AssetController {
  constructor(private readonly assets: AssetService) {}

  @Get()
  list(@Query() query: QueryAssetDto, @CurrentUser() user: AuthUser) {
    return this.assets.list(String(user.userId), query);
  }

  @Post()
  create(@Body() dto: CreateAssetDto, @CurrentUser() user: AuthUser) {
    return this.assets.create(String(user.userId), dto);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 } }))
  upload(@UploadedFile() file: Express.Multer.File, @Body('name') name: string | undefined, @CurrentUser() user: AuthUser) {
    if (!file) throw new BadRequestException('请选择要上传的文件');
    return this.assets.upload(String(user.userId), file, name);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.assets.remove(String(user.userId), id);
  }
}
