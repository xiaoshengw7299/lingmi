/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_APP_TITLE?: string
  /** ICP 备案号，配了就显示在首页页脚 */
  readonly VITE_ICP?: string
  /** 运营主体名称，写进用户协议和隐私政策 */
  readonly VITE_COMPANY_NAME?: string
  /** 联系邮箱，配了才会在协议末尾和首页联系按钮里展示 */
  readonly VITE_CONTACT_EMAIL?: string
  /** 首页联系按钮的微信二维码地址，不配则用 /wechat-qr.png */
  readonly VITE_WECHAT_QR?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface XhsShareFail {
  message?: string
  errMsg?: string
}

interface Window {
  xhs?: {
    share: (options: {
      shareInfo: { type: 'video'; title?: string; content?: string; video: string }
      verifyConfig: { appKey: string; nonce: string; timestamp: string; signature: string }
      fail?: (error?: XhsShareFail) => void
    }) => void
  }
}

declare module 'qrcode' {
  export function toDataURL(
    text: string,
    options?: {
      width?: number
      margin?: number
      errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
      color?: { dark?: string; light?: string }
    },
  ): Promise<string>
}
