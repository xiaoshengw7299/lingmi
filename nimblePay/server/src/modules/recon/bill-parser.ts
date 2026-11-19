import iconv from 'iconv-lite';
import JSZip from 'jszip';
import { gunzipSync } from 'zlib';
import { parseYuanToCents } from '../../common/money';

export type BillRow = {
  bizType: 'PAY' | 'REFUND' | 'TRANSFER' | 'FEE' | 'OTHER';
  channelTradeNo: string;
  channelOutNo: string;
  channelRefundNo: string;
  amountCents: number;
  feeCents: number;
  receiptCents: number;
  status: string;
  time: string;
  raw: Record<string, string>;
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

export async function unzipBillCsv(buf: Buffer): Promise<string> {
  let data = buf;
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    data = Buffer.from(gunzipSync(data));
  }
  if (data.length >= 2 && data[0] === 0x50 && data[1] === 0x4b) {
    const zip = await JSZip.loadAsync(data);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && /\.(csv|txt)$/i.test(n));
    const name =
      names.find((n) => /明细|detail|trade|账务/.test(n) && !/汇总|sum/i.test(n)) ||
      names.find((n) => /明细|detail|trade|账/i.test(n)) ||
      names[0];
    if (!name) throw new Error('账单压缩包中没有 CSV');
    data = Buffer.from(await zip.files[name].async('uint8array'));
  }
  const gbk = iconv.decode(data, 'gbk');
  if (gbk.includes('商户订单号') || gbk.includes('支付宝交易号') || gbk.includes('业务流水号')) return gbk;
  return data.toString('utf8');
}

export function parseAlipayBill(text: string, billType: 'trade' | 'signcustomer'): BillRow[] {
  const table = parseCsv(text);
  const headerIdx = table.findIndex((r) => r.some((c) => /商户订单号|支付宝交易号|业务流水号/.test(c)));
  if (headerIdx < 0) return [];
  const header = table[headerIdx].map((h) => h.replace(/^#/, '').trim());
  const rows: BillRow[] = [];
  for (const cells of table.slice(headerIdx + 1)) {
    if (!cells.join('').trim()) continue;
    if (/合计|小计|^#/.test(cells[0] || '')) continue;
    const raw: Record<string, string> = {};
    header.forEach((h, i) => {
      if (h) raw[h] = (cells[i] || '').trim();
    });
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const hit = Object.keys(raw).find((x) => x.includes(k));
        if (hit && raw[hit]) return raw[hit];
      }
      return '';
    };
    const bizRaw = get('业务类型', '业务描述');
    const amount = safeBillCents(get('订单金额', '发生额', '收入金额') || inverse(get('支出金额')));
    const fee = Math.abs(safeBillCents(get('服务费', '手续费')));
    const receipt = safeBillCents(get('商家实收', '实收金额'));
    rows.push({
      bizType: classify(bizRaw, billType, amount),
      channelTradeNo: get('支付宝交易号', '业务流水号', '账务流水号'),
      channelOutNo: get('商户订单号', '商户请求号'),
      channelRefundNo: get('退款批次号', '退款请求号'),
      amountCents: amount,
      feeCents: fee,
      receiptCents: receipt,
      status: bizRaw,
      time: get('完成时间', '发生时间', '创建时间'),
      raw,
    });
  }
  return rows;
}

function safeBillCents(raw: string) {
  try {
    return parseYuanToCents(raw);
  } catch {
    return 0;
  }
}

function inverse(v: string) {
  if (!v) return '';
  return v.startsWith('-') ? v.slice(1) : `-${v}`;
}

function classify(biz: string, billType: 'trade' | 'signcustomer', amount: number): BillRow['bizType'] {
  if (/退款/.test(biz) || (billType === 'trade' && amount < 0 && /退/.test(biz))) return 'REFUND';
  if (/转账|提现/.test(biz)) return 'TRANSFER';
  if (/收费|服务费|手续费/.test(biz)) return 'FEE';
  if (/交易|在线支付|收单/.test(biz) || (billType === 'trade' && amount > 0)) return 'PAY';
  return 'OTHER';
}
