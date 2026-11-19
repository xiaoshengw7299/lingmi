import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { AuthUser } from '../../common/types/auth-user';
import { CreateForumCommentDto, CreateForumPostDto, FORUM_MAX_BYTES, QueryForumDto, UpdateForumPostDto, UpdateForumStatusDto } from './forum.dto';
import { ForumService } from './forum.service';

@Controller('forum')
export class ForumController {
  constructor(private readonly forum: ForumService) {}

  @Public()
  @Get('posts')
  list(@Query() query: QueryForumDto, @CurrentUser() user?: AuthUser) {
    return this.forum.list(query, user);
  }

  @Public()
  @Get('posts/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthUser) {
    return this.forum.get(id, user);
  }

  @Post('uploads')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: FORUM_MAX_BYTES, files: 1 } }))
  upload(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) {
    if (!file) throw new BadRequestException('请选择要上传的文件');
    return this.forum.upload(user, file);
  }

  @Post('posts')
  create(@Body() dto: CreateForumPostDto, @CurrentUser() user: AuthUser) {
    return this.forum.create(user, dto);
  }

  @Patch('posts/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateForumPostDto, @CurrentUser() user: AuthUser) {
    return this.forum.update(id, user, dto);
  }

  @Delete('posts/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.forum.remove(id, user);
  }

  @Post('posts/:id/like')
  like(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.forum.like(id, user);
  }

  @Post('posts/:id/comments')
  comment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateForumCommentDto, @CurrentUser() user: AuthUser) {
    return this.forum.comment(id, user, dto);
  }

  @Delete('posts/:id/comments/:commentId')
  removeComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.forum.removeComment(id, commentId, user);
  }

  @Patch('posts/:id/status')
  @UseGuards(PlatformAdminGuard)
  status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateForumStatusDto, @CurrentUser() user: AuthUser) {
    return this.forum.setStatus(id, dto.status, user);
  }
}
