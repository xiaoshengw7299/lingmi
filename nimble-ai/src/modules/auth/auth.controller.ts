import { Body, Controller, Get, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthService, AvatarFile } from './auth.service';
import { ChangePasswordDto, LoginDto, LoginNameDto, UpdateProfileDto, WechatLoginDto } from './dto/auth.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../../common/guards/rate-limit.guard';
import { CurrentUser } from '../../common/decorators/user.decorator';

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('providers')
  providers() {
    return this.authService.providers();
  }

  @Public()
  @Post('login')
  @RateLimit(10)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Get('wechat/connect')
  wechatConnect() {
    return this.authService.wechatConnect();
  }

  @Public()
  @Post('wechat/login')
  @RateLimit(10)
  loginByWechat(@Body() dto: WechatLoginDto) {
    return this.authService.loginByWechat(dto);
  }

  @Public()
  @Post('refresh')
  @RateLimit(30)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@CurrentUser() user: any) {
    return this.authService.logout(user.userId);
  }

  @Get('me')
  getMe(@CurrentUser() user: any) {
    return this.authService.getMe(user.userId);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.userId, dto);
  }

  @Patch('password')
  @RateLimit(5)
  changePassword(@CurrentUser() user: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.userId, dto);
  }

  @Patch('login-name')
  @RateLimit(10)
  changeLoginName(@CurrentUser() user: any, @Body() dto: LoginNameDto) {
    return this.authService.changeLoginName(user.userId, dto);
  }

  @Post('avatar')
  @RateLimit(10)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } }))
  uploadAvatar(@CurrentUser() user: any, @UploadedFile() file: AvatarFile) {
    return this.authService.uploadAvatar(user.userId, file);
  }
}
