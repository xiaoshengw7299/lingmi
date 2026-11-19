# nimblePay

nimble 的支付与余额服务。用户在 nimble 注册，在用户中心充值。nimblePay 负责支付宝收款、余额、消费扣款与退回、邀请奖励、退款、转账、分账和对账。

## 目录

- `server` NestJS + TypeORM + PostgreSQL + Redis
- `web` Vue 3 + Element Plus 运营后台

## 启动

```bash
cd nimblePay/server
cp .env.example .env
npm install
npm run start:dev
```

另开一个终端：

```bash
cd nimblePay/web
npm install
npm run dev
```

配置项和 nimble-ai 对齐：`APP_PORT`、`APP_PREFIX`、`DB_*`、`REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB`、`JWT_SECRET`。接口响应也是 `{ code, message, data }`，成功时 `code` 为 200。

- 接口 http://127.0.0.1:8090/api
- 后台 http://127.0.0.1:5174
- 默认管理员 `admin` / `NimblePay@2026`

数据库 `nimblepay` 需先建好。开发环境会自动建表。

nimble-ai 需要配置同一套 `NIMBLEPAY_APP_ID` 与 `NIMBLEPAY_APP_SECRET`。开放接口（服务之间调用）的金额字段 `*Cents` 单位是分，整数传输避免浮点误差；后台界面和后台接口一律用元，服务端自己换算。开放接口签名与 lingPay 相同：

```
canonical = timestamp + "\n" + nonce + "\n" + METHOD + "\n" + path + "\n" + sha256(rawBody)
sign = hmac_sha256_hex(NIMBLE_APP_SECRET, canonical)
```

## 开放接口（`/api/open/v1`，需签名）

| 接口 | 说明 |
|------|------|
| `POST wallet/ensure` | 开户（幂等）。可带 `inviterExternalUserId` 绑定邀请人；开户时按配置发注册赠送 |
| `GET wallet/:externalUserId` | 余额 |
| `POST wallet/consume` | 消费扣款。`bizNo` 幂等；余额不足返回 HTTP 402；`partial=true` 时扣到 0 不报错 |
| `POST wallet/consume/refund` | 按 `bizNo` 退回一笔消费，重复调用不会重复退 |
| `GET wallet/:externalUserId/ledgers` | 账单流水，金额带正负号 |
| `GET referral/:externalUserId` | 邀请概况与被邀请人列表 |
| `GET reward-rule` | 当前奖励规则（首页活动横幅用） |
| `POST pay/recharge`、`GET pay/orders/:orderNo` | 充值下单与查单 |
| `POST wallet/summaries` | 批量钱包概况（余额、累计充值、累计消费），nimble 管理后台的用户列表用，一次最多 100 个用户 |
| `GET stats` | 真实充值汇总（不含测试单）：充值用户数、金额、今日数据、近 14 天趋势，nimble 平台统计页用 |

开放接口每分钟总限额默认 3000，可用 `OPEN_RATE_LIMIT_PER_MIN` 调整（文本模型会产生较多小额扣款）。

## 奖励规则

后台「支付宝 → 业务参数」里改，按元填写（最多两位小数），改完立即生效。库里存的是分，服务端读写时换算：

| 配置项 | 默认 | 说明 |
|--------|------|------|
| `reward.signupGiftCents` | 0 元 | 新用户注册赠送，0 表示不送 |
| `reward.referralCents` | 14 元 | 邀请奖励：被邀请人首次充值达标后，邀请人得到的金额 |
| `reward.referralMinRechargeCents` | 1 元 | 被邀请人单次充值至少多少才算达标 |

- 每个被邀请人只会给邀请人发一次奖励（以 `ref:<关系ID>` 做幂等）；不能邀请自己，也不能互相邀请。
- 只有真实充值才触发，支付宝测试单不算。奖励以余额入账，只能消费、不能提现。
- 退款不会收回已发的奖励；如需追回，在后台「用户余额」里手工扣款。

## 生产环境数据库变更

生产环境 `synchronize` 是关闭的，上线前先手工执行（需要 `uuid-ossp` 扩展，原有表已经依赖它）：

```sql
ALTER TABLE np_wallet_ledger ADD COLUMN IF NOT EXISTS "bizNo" varchar;
CREATE UNIQUE INDEX IF NOT EXISTS idx_np_wallet_ledger_biz ON np_wallet_ledger ("bizNo", type);

CREATE TABLE IF NOT EXISTS np_referral (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "inviterId" uuid NOT NULL REFERENCES np_wallet_user(id) ON DELETE CASCADE,
  "inviteeId" uuid NOT NULL UNIQUE REFERENCES np_wallet_user(id) ON DELETE CASCADE,
  status varchar NOT NULL DEFAULT 'BOUND',
  "rewardCents" integer NOT NULL DEFAULT 0,
  "rewardedAt" timestamptz,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_np_referral_inviter ON np_referral ("inviterId", "createdAt");
```

三个奖励配置项（`reward.*`）会在服务启动时自动写入业务参数表，不需要手工插入。
