import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException } from '../../common/api-exception';
import { ALIPAY_PRODUCT_PAGE, REWARD_SETTINGS } from '../../common/constants';
import { SecretService } from '../../common/crypto/secret.service';
import { looksMasked, maskSecret } from '../../common/ids';
import { centsToYuan, yuanToCents } from '../../common/money';
import { AlipayConfig, SysSetting } from '../../entities';
import { AlipayService } from '../../infra/alipay/alipay.service';
import { PaymentService } from '../payment/payment.service';

const SETTING_KEYS = new Set([
  'order.expireMinutes',
  'division.defaultMode',
  'pay.minRechargeCents',
  'site.name',
  ...Object.values(REWARD_SETTINGS).map((s) => s.key),
]);

/** 金额类业务参数：后台界面按元填写和显示，库里存分（其它模块直接按分读取），读写时在这里换算 */
const MONEY_KEYS = new Set(['pay.minRechargeCents', ...Object.values(REWARD_SETTINGS).map((s) => s.key)]);
const SETTING_UNITS: Record<string, string> = { 'order.expireMinutes': '分钟' };

@Injectable()
export class ChannelConfigService {
  constructor(
    @InjectRepository(AlipayConfig) private readonly configs: Repository<AlipayConfig>,
    @InjectRepository(SysSetting) private readonly settings: Repository<SysSetting>,
    private readonly secrets: SecretService,
    private readonly alipay: AlipayService,
    private readonly payment: PaymentService,
  ) {}

  async getAlipay() {
    let cfg = await this.configs.findOne({ where: { id: 'default' } });
    if (!cfg) cfg = await this.configs.save(this.configs.create({ id: 'default' }));
    return {
      enabled: cfg.enabled,
      sandbox: cfg.sandbox,
      appId: cfg.appId,
      signType: cfg.signType,
      keyType: cfg.keyType,
      useCert: cfg.useCert,
      notifyUrlOverride: cfg.notifyUrlOverride,
      notifyUrl: await this.alipay.notifyUrl('pay'),
      refundNotifyUrl: await this.alipay.notifyUrl('refund'),
      transferNotifyUrl: await this.alipay.notifyUrl('transfer'),
      returnUrl: this.alipay.returnUrl(),
      productName: '电脑网站支付',
      productCode: ALIPAY_PRODUCT_PAGE,
      privateKey: cfg.privateKeyEnc ? maskSecret(this.safeDec(cfg.privateKeyEnc), 6, 4) : '',
      alipayPublicKey: cfg.alipayPublicKeyEnc ? maskSecret(this.safeDec(cfg.alipayPublicKeyEnc), 6, 4) : '',
      hasAppCert: Boolean(cfg.appCertEnc),
      hasAlipayPublicCert: Boolean(cfg.alipayPublicCertEnc),
      hasRootCert: Boolean(cfg.alipayRootCertEnc),
      updatedAt: cfg.updatedAt,
    };
  }

  async saveAlipay(input: {
    enabled?: boolean;
    sandbox?: boolean;
    appId?: string;
    signType?: string;
    keyType?: string;
    useCert?: boolean;
    notifyUrlOverride?: string;
    privateKey?: string;
    alipayPublicKey?: string;
    appCert?: string;
    alipayPublicCert?: string;
    alipayRootCert?: string;
  }) {
    let cfg = await this.configs.findOne({ where: { id: 'default' } });
    if (!cfg) cfg = this.configs.create({ id: 'default' });
    if (input.enabled != null) cfg.enabled = input.enabled;
    if (input.sandbox != null) cfg.sandbox = input.sandbox;
    if (input.appId != null) cfg.appId = input.appId.trim();
    if (input.signType) cfg.signType = input.signType;
    if (input.keyType) cfg.keyType = input.keyType;
    if (input.useCert != null) cfg.useCert = input.useCert;
    if (input.notifyUrlOverride != null) cfg.notifyUrlOverride = input.notifyUrlOverride.trim();
    if (input.privateKey && !looksMasked(input.privateKey)) cfg.privateKeyEnc = this.secrets.encrypt(normalizePem(input.privateKey));
    if (input.alipayPublicKey && !looksMasked(input.alipayPublicKey)) cfg.alipayPublicKeyEnc = this.secrets.encrypt(normalizePem(input.alipayPublicKey));
    if (input.appCert && !looksMasked(input.appCert)) cfg.appCertEnc = this.secrets.encrypt(input.appCert);
    if (input.alipayPublicCert && !looksMasked(input.alipayPublicCert)) cfg.alipayPublicCertEnc = this.secrets.encrypt(input.alipayPublicCert);
    if (input.alipayRootCert && !looksMasked(input.alipayRootCert)) cfg.alipayRootCertEnc = this.secrets.encrypt(input.alipayRootCert);
    await this.configs.save(cfg);
    this.alipay.invalidate();
    return this.getAlipay();
  }

  ping() {
    return this.alipay.ping();
  }

  testPay(clientIp?: string) {
    return this.payment.createTestPay(clientIp);
  }

  async listSettings() {
    const rows = await this.settings.find({ order: { group: 'ASC', key: 'ASC' } });
    return rows.map(toSettingView);
  }

  async saveSetting(key: string, value: string) {
    if (!SETTING_KEYS.has(key)) throw ApiException.bad('不支持的配置项');
    if (key === 'order.expireMinutes') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 1440) throw ApiException.bad('超时分钟须为 1～1440');
    }
    if (MONEY_KEYS.has(key)) {
      const cents = yuanToCents(value);
      if (key === 'pay.minRechargeCents' && cents < 1) throw ApiException.bad('最低充值金额至少 0.01 元');
      value = String(cents);
    }
    if (key === 'division.defaultMode' && !['AUTO', 'MANUAL', 'FORBID'].includes(value)) {
      throw ApiException.bad('分账模式只能是 AUTO、MANUAL、FORBID');
    }
    let row = await this.settings.findOne({ where: { key } });
    if (!row) throw ApiException.notFound('配置不存在');
    row.value = value;
    await this.settings.save(row);
    return toSettingView(row);
  }

  private safeDec(payload: string) {
    try {
      return this.secrets.decrypt(payload);
    } catch {
      return '';
    }
  }
}

function toSettingView(row: SysSetting) {
  const money = MONEY_KEYS.has(row.key);
  const cents = Number(row.value);
  return {
    key: row.key,
    name: row.name,
    group: row.group,
    value: money && Number.isInteger(cents) ? centsToYuan(cents) : row.value,
    unit: money ? '元' : SETTING_UNITS[row.key],
  };
}

function normalizePem(raw: string) {
  return raw.replace(/\\n/g, '\n').trim();
}
