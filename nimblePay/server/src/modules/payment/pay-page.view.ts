import { centsToYuan } from '../../common/money';

export type PayPageKind = 'jump' | 'success' | 'pending' | 'closed' | 'error';

export function renderPayPage(input: {
  kind: PayPageKind;
  title: string;
  message: string;
  subject?: string;
  amountCents?: number;
  orderNo?: string;
  formHtml?: string;
  refreshSeconds?: number;
}) {
  const kindLabel: Record<PayPageKind, string> = {
    jump: '支付宝电脑网站支付',
    success: '支付成功',
    pending: '确认中',
    closed: '未完成',
    error: '无法继续',
  };
  const refresh = input.kind === 'pending' && input.refreshSeconds ? input.refreshSeconds : 0;
  const form = input.formHtml ? injectSubmit(input.formHtml) : '';
  const amount =
    input.amountCents != null ? `¥ ${esc(centsToYuan(input.amountCents))}` : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  ${refresh ? `<meta http-equiv="refresh" content="${refresh}"/>` : ''}
  <title>${esc(input.title)} · lingPay</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background:
        radial-gradient(circle at 12% 10%, #99f6e4 0, transparent 32%),
        radial-gradient(circle at 88% 90%, #5eead4 0, transparent 28%),
        #042f2e;
      color: #0f172a;
    }
    .card {
      width: min(440px, calc(100vw - 32px));
      background: #fff;
      border-radius: 22px;
      padding: 32px 28px 26px;
      box-shadow: 0 30px 80px rgba(0,0,0,.25);
    }
    .eyebrow { margin: 0; color: #0f766e; font-size: 12px; font-weight: 800; letter-spacing: .08em; }
    h1 { margin: 10px 0 0; font-size: 26px; letter-spacing: -.03em; }
    .lead { margin: 12px 0 0; color: #64748b; line-height: 1.7; }
    .summary {
      margin: 22px 0 8px; padding: 14px 16px; border-radius: 14px; background: #f4f7f7;
    }
    .summary strong { display: block; font-size: 22px; }
    .summary span, .meta { display: block; margin-top: 6px; color: #64748b; font-size: 13px; }
    .btn {
      display: block; width: 100%; margin-top: 18px; border: 0; border-radius: 12px;
      padding: 12px 16px; background: #1677ff; color: #fff; font-size: 16px; font-weight: 700;
      cursor: pointer; text-align: center; text-decoration: none;
    }
    .ok { color: #0f766e; }
    .warn { color: #b45309; }
    .bad { color: #b91c1c; }
    .foot { margin: 18px 0 0; color: #94a3b8; font-size: 12px; text-align: center; }
    form { margin: 0; }
  </style>
</head>
<body>
  <main class="card">
    <p class="eyebrow">${esc(kindLabel[input.kind])}</p>
    <h1 class="${input.kind === 'success' ? 'ok' : input.kind === 'error' || input.kind === 'closed' ? 'bad' : input.kind === 'pending' ? 'warn' : ''}">${esc(input.title)}</h1>
    <p class="lead">${esc(input.message)}</p>
    ${amount || input.subject || input.orderNo ? `<div class="summary">
      ${amount ? `<strong>${amount}</strong>` : ''}
      ${input.subject ? `<span>${esc(input.subject)}</span>` : ''}
      ${input.orderNo ? `<span class="meta">订单号 ${esc(input.orderNo)}</span>` : ''}
    </div>` : ''}
    ${form}
    <p class="foot">lingPay · 请勿重复付款</p>
  </main>
</body>
</html>`;
}

/** 仅用于跳转支付宝：立刻 POST 表单，新窗口应直接进入支付宝收银台。 */
export function renderAlipayJumpPage(formHtml: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>正在打开支付宝</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #64748b; }
    p { padding: 24px 24px 8px; }
    .btn {
      display: block; width: min(360px, calc(100% - 48px)); margin: 16px 24px 0; border: 0; border-radius: 12px;
      padding: 12px 16px; background: #1677ff; color: #fff; font-size: 16px; font-weight: 700;
      cursor: pointer; text-align: center; text-decoration: none;
    }
    form { margin: 0; }
  </style>
</head>
<body>
  <p>正在打开支付宝付款页…</p>
  ${injectSubmit(formHtml)}
</body>
</html>`;
}

function injectSubmit(formHtml: string) {
  const raw = String(formHtml || '').trim();
  if (!raw) return '';
  if (!/<form[\s>]/i.test(raw)) {
    const href = esc(raw);
    return `<a class="btn" href="${href}" rel="noopener">去支付宝付款</a>
      <script>location.replace(${JSON.stringify(raw)});</script>`;
  }
  let html = raw.replace(/<script[\s\S]*?<\/script>/gi, '').trim();
  if (!/\btarget\s*=/i.test(html)) {
    html = html.replace(/<form\b/i, '<form target="_top"');
  }
  if (!/<button\b/i.test(html)) {
    html = html.replace(/<\/form>/i, '<button type="submit" class="btn">去支付宝付款</button></form>');
  }
  return `${html}
    <script>
      (function () {
        var f = document.querySelector('form');
        if (!f) return;
        setTimeout(function () {
          try { f.requestSubmit(); } catch (e) { f.submit(); }
        }, 30);
      })();
    </script>`;
}

function esc(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function flattenQuery(query: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(query || {})) {
    if (raw == null) continue;
    out[key] = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw);
  }
  return out;
}
