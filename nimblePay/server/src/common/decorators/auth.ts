import { SetMetadata } from '@nestjs/common';

export const PERM_KEY = 'required_perm';
export const RequirePerm = (perm: string) => SetMetadata(PERM_KEY, perm);
export const Public = () => SetMetadata('is_public', true);
export const IS_PUBLIC = 'is_public';
