import { ElMessage } from 'element-plus'

/** 复制到剪贴板并提示；浏览器不给权限时提醒用户手动复制 */
export async function copyText(text: string, tip: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(tip)
  } catch {
    ElMessage.warning('复制失败，请手动选中复制')
  }
}
