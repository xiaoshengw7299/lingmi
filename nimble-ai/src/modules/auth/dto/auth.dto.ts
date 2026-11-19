import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginNameDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9]{4,32}$/, { message: '登录账号须为 4～32 位字母或数字' })
  account: string;
}

export class LoginDto extends LoginNameDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  password: string;
}

export class UpdateProfileDto {
  @IsString()
  @MaxLength(32)
  nickname: string;
}

export class ChangePasswordDto {
  /** 已设置过密码的账号必填；首次设置密码可不填 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  oldPassword?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  newPassword: string;
}

export class WechatLoginDto {
  @IsString()
  code: string;

  @IsString()
  state: string;

  /** 邀请人的推广码，来自分享链接 ?ref=。分销商和邀请有礼用同一条链接 */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  ref?: string;
}
