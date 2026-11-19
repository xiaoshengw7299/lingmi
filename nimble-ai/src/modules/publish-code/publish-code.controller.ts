import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { RateLimit } from '../../common/guards/rate-limit.guard';
import { AuthUser } from '../../common/types/auth-user';
import {
  PublicShareDto,
  UpdatePublishCodeDto,
  VideoShareDto,
} from './publish-code.dto';
import { PublishCodeService } from './publish-code.service';
import { ShareOpenService } from './share-open.service';
import { VideoShareService } from './video-share.service';

@Controller('publish-code')
export class PublishCodeController {
  constructor(
    private readonly publishCodeService: PublishCodeService,
    private readonly videoShareService: VideoShareService,
    private readonly open: ShareOpenService,
  ) {}

  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.publishCodeService.mine(user.userId);
  }

  @Put()
  update(@Body() dto: UpdatePublishCodeDto, @CurrentUser() user: AuthUser) {
    return this.publishCodeService.update(user.userId, dto);
  }

  @Public()
  @Get('platforms')
  platforms() {
    return this.open.platforms();
  }

  @Public()
  @RateLimit(40)
  @Header('Cache-Control', 'no-store')
  @Post('video')
  shareVideo(@Body() dto: VideoShareDto, @CurrentUser() user?: AuthUser) {
    return this.videoShareService.prepare(dto, user);
  }

  @Public()
  @RateLimit(600)
  @Get('p/:code')
  landing(@Param('code') code: string, @CurrentUser() user?: AuthUser) {
    return this.publishCodeService.landing(code, user?.userId);
  }

  @Public()
  @RateLimit(40)
  @Post('p/:code/douyin')
  douyin(@Param('code') code: string, @Body() dto: PublicShareDto) {
    return this.publishCodeService.douyin(code, dto);
  }

  @Public()
  @RateLimit(40)
  @Post('p/:code/xhs')
  xhs(@Param('code') code: string, @Body() dto: PublicShareDto) {
    return this.publishCodeService.xhs(code, dto);
  }
}
