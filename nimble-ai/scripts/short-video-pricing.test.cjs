const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ConfigService } = require('@nestjs/config');
const { BillingService } = require('../dist/modules/billing/billing.service');
const { runWithBilling } = require('../dist/modules/billing/billing-context');
const { llmBillingMiddleware } = require('../dist/modules/billing/llm-billing.middleware');
const { ShortVideoPricingService } = require('../dist/modules/short-video/short-video-pricing.service');

function setup() {
  const config = new ConfigService();
  const debits = [];
  const walletChecks = [];
  const usage = [];
  const billing = new BillingService(
    config,
    {
      enabled: () => true,
      consume: async (request) => {
        debits.push(request);
        return { balanceCents: 500 - request.amountCents };
      },
    },
    {
      balanceCents: async (userId) => {
        walletChecks.push(userId);
        return userId === 1 ? 0 : 500;
      },
      rememberBalance: async () => {},
    },
    {
      quote: async () => ({ cents: 25, upstreamCents: 25 }),
      displayName: async () => 'test model',
      llmRates: async () => null,
    },
    {},
    { insert: async (record) => usage.push(record) },
  );
  let storedPromotion = null;
  const pricing = new ShortVideoPricingService({
    get: async () => storedPromotion,
    set: async (_key, value) => { storedPromotion = value; },
  }, billing);
  const setWindow = (start, end) => pricing.savePromotion({
    enabled: true, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(),
  });
  return { pricing, setWindow, billing, debits, walletChecks, usage };
}

test('活动包含开始时刻，结束即恢复现有报价，未配置时按量计费', async () => {
  const { pricing, setWindow } = setup();
  const start = Date.now();
  const end = start + 10_000;
  assert.equal((await pricing.quote(start)).mode, 'metered');
  await setWindow(start, end);
  assert.equal((await pricing.quote(start - 1)).mode, 'metered');
  assert.equal((await pricing.quote(start)).chargeCents, 0);
  assert.equal((await pricing.quote(end - 1)).mode, 'promotion');
  assert.equal((await pricing.quote(end)).mode, 'metered');
  assert.equal((await pricing.quote(end)).minBalanceCents, 100);
});

test('过期报价先返回 409 和当前价格，确认后才进行正常余额校验', async () => {
  const { pricing, setWindow, walletChecks } = setup();
  await setWindow(Date.now() - 20_000, Date.now() - 10_000);
  await assert.rejects(() => pricing.accept('1', 'promotion', 100), (error) => {
    assert.equal(error.getStatus(), 409);
    assert.equal(error.getResponse().data.shortVideoQuote.mode, 'metered');
    assert.equal(error.getResponse().data.shortVideoQuote.minBalanceCents, 100);
    return true;
  });
  assert.deepEqual(walletChecks, []);
  await assert.rejects(() => pricing.accept('1', 'metered', 100), (error) => error.getStatus() === 402);
  assert.deepEqual(walletChecks, [1]);
});

test('已受理的免单任务到期后仍免除文案和媒体费用，同期其他业务仍扣费', async () => {
  const { pricing, setWindow, billing, debits, walletChecks, usage } = setup();
  await setWindow(Date.now() - 10_000, Date.now() + 10_000);
  const accepted = await pricing.accept('1', 'promotion', 100);
  assert.equal(accepted.chargeCents, 0);

  await runWithBilling('2', () => billing.chargeMedia('image', { model: 'image' }));
  await pricing.savePromotion({ ...await pricing.getPromotion(), enabled: false });
  assert.equal((await pricing.quote()).mode, 'metered');
  await runWithBilling('1', async () => {
    await billing.assertCanSpend('1');
    const result = await llmBillingMiddleware(billing, 'text').wrapGenerate({
      doGenerate: async () => ({ usage: {} }),
    });
    assert.deepEqual(result, { usage: {} });
    assert.equal(await billing.chargeMedia('image', { model: 'image' }), null);
    assert.equal(await billing.chargeQuoted('audio', { cents: 25, upstreamCents: 25 }), null);
    assert.equal(await billing.refund(null), true);
  }, { waived: accepted.chargeCents === 0 });
  assert.deepEqual(walletChecks, []);
  assert.equal(debits.length, 1);
  assert.equal(debits[0].externalUserId, '2');
  assert.equal(usage.length, 1);
  assert.equal(usage[0].chargeCents, 25);
});

test('保存时校验活动时段，并把北京时间转换为同一 UTC 时刻', async () => {
  const { pricing } = setup();
  const startsAt = '2026-11-16T09:30:15+08:00';
  const endsAt = '2026-11-16T18:30:00+08:00';
  await assert.rejects(() => pricing.savePromotion({ enabled: true, startsAt, endsAt: null }), /填写开始时间和结束时间/);
  await assert.rejects(() => pricing.savePromotion({ enabled: false, startsAt: endsAt, endsAt: startsAt }), /结束时间须晚于开始时间/);
  await pricing.savePromotion({ enabled: true, startsAt, endsAt });
  assert.deepEqual(await pricing.getPromotion(), {
    enabled: true, startsAt: '2026-11-16T01:30:15.000Z', endsAt: '2026-11-16T10:30:00.000Z',
  });
});
