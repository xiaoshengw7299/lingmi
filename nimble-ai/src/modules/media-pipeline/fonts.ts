import * as path from 'path';

/**
 * 字幕烧录固定使用随包字体（思源黑体，Noto Sans SC，OFL 开源协议），不依赖部署环境是否装了中文字体，
 * 保证 Linux 生产环境开箱即可正确渲染中文字幕。resource/fonts 下只放这两个文件，新增字重需同步更新此表。
 */
export const FONT_FILES: Record<string, string> = {
  regular: path.join(process.cwd(), 'resource', 'fonts', 'NotoSansSC-Regular.otf'),
  bold: path.join(process.cwd(), 'resource', 'fonts', 'NotoSansSC-Bold.otf'),
};

export const DEFAULT_FONT_KEY = 'regular';

export function resolveFontPath(fontKey?: string | null): string {
  return FONT_FILES[fontKey ?? ''] ?? FONT_FILES[DEFAULT_FONT_KEY];
}
