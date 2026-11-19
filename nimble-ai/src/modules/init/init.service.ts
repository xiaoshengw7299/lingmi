import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User } from '../user/entities/user.entity';

const ACCOUNT_PATTERN = /^[a-z0-9]{4,32}$/;

@Injectable()
export class InitService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InitService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    await this.ensureSchema();

    const configuredAccount = (this.configService.get<string>('ADMIN_ACCOUNT') || '').trim().toLowerCase();
    const account =
      configuredAccount || (process.env.NODE_ENV === 'production' ? '' : 'admin');
    const plainPassword =
      this.configService.get<string>('ADMIN_PASSWORD') ||
      (process.env.NODE_ENV === 'production' ? '' : 'ly@0807.');
    if (account && !ACCOUNT_PATTERN.test(account)) {
      this.logger.warn(`ADMIN_ACCOUNT「${account}」无效，需为 4～32 位小写字母或数字`);
      return;
    }

    // 默认管理员只有一个；还没标记过时（老数据），取最早的管理员
    const admin =
      (await this.userRepo.findOne({ where: { isSuperAdmin: true } })) ??
      (await this.userRepo.findOne({ where: { isAdmin: true }, order: { id: 'ASC' } }));
    if (!admin && account && plainPassword) {
      const existing = await this.userRepo.findOne({ where: { loginName: account } });
      if (existing) {
        // 登录账号允许用户修改，不能按这个可变字段为已有账号授予管理员权限。
        this.logger.warn(`超管初始化失败：登录账号 ${account} 已被占用，请配置新的 ADMIN_ACCOUNT`);
        return;
      }
      await this.userRepo.save(
        this.userRepo.create({
          loginName: account,
          nickname: '平台管理员',
          isAdmin: true,
          isSuperAdmin: true,
          password: await bcrypt.hash(plainPassword, 10),
        }),
      );
      this.logger.log(`已创建平台超管 ${account}`);
      return;
    }

    if (admin && !admin.isSuperAdmin) {
      await this.userRepo.update(admin.id, { isSuperAdmin: true });
      admin.isSuperAdmin = true;
    }

    if (admin && !admin.loginName) {
      const name = account || 'admin';
      const taken = await this.userRepo.findOne({ where: { loginName: name }, select: { id: true } });
      if (!taken || taken.id === admin.id) {
        await this.userRepo.update(admin.id, { loginName: name });
        admin.loginName = name;
        this.logger.log(`已为超管分配登录账号 ${name}`);
      } else {
        this.logger.warn(`登录账号 ${name} 已被占用，超管 ${admin.id} 还不能用账号登录`);
      }
    }

    if (!admin || !plainPassword) return;
    const withPassword = await this.userRepo
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.id = :id', { id: admin.id })
      .getOne();
    if (withPassword && !withPassword.password) {
      await this.userRepo.update(admin.id, { password: await bcrypt.hash(plainPassword, 10) });
      this.logger.log(`已为超管 ${withPassword.loginName || admin.id} 设置初始密码`);
    }
  }

  /** 生产环境不自动同步表结构，这里补上登录账号列、分销字段和账单的成本列，并去掉不再使用的邮箱列 */
  private async ensureSchema() {
    await this.userRepo.query(
      `ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "login_name" character varying(32)`,
    );
    await this.userRepo.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_account_login_name" ON "account" ("login_name")`,
    );
    try {
      await this.userRepo.query(`ALTER TABLE "account" DROP COLUMN IF EXISTS "email"`);
    } catch (error) {
      this.logger.warn(`移除邮箱字段失败：${error instanceof Error ? error.message : error}`);
    }
    await this.userRepo.query(
      `ALTER TABLE "account"
         ADD COLUMN IF NOT EXISTS "is_distributor" boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS "commission_percent" double precision NOT NULL DEFAULT 0,
         ADD COLUMN IF NOT EXISTS "distributor_id" integer,
         ADD COLUMN IF NOT EXISTS "distributor_level" smallint NOT NULL DEFAULT 0,
         ADD COLUMN IF NOT EXISTS "parent_distributor_id" integer`,
    );
    await this.userRepo.query(
      `CREATE INDEX IF NOT EXISTS "IDX_account_distributor" ON "account" ("distributor_id")`,
    );
    await this.userRepo.query(
      `CREATE INDEX IF NOT EXISTS "IDX_account_parent_distributor" ON "account" ("parent_distributor_id")`,
    );
    // 上线二级分销之前只有一层。现任分销商，以及已取消但名下还有用户的，都视为一级
    await this.userRepo.query(
      `UPDATE "account" SET "distributor_level" = 1
       WHERE "distributor_level" = 0
         AND ("is_distributor" = true OR EXISTS (SELECT 1 FROM "account" m WHERE m."distributor_id" = "account"."id"))`,
    );
    await this.migrateUsageLog();
    // 奖励一度按作者合计，那个表不能沿用。每个作品单独一张记录
    await this.userRepo.query(`DROP TABLE IF EXISTS "example_share_reward"`);
    await this.userRepo.query(
      `CREATE TABLE IF NOT EXISTS "publish_code" (
         "id" SERIAL PRIMARY KEY,
         "user_id" integer NOT NULL,
         "code" varchar(16) NOT NULL,
         "enabled" boolean NOT NULL DEFAULT true,
         "display_name" varchar(40) NOT NULL DEFAULT '',
         "caption" varchar(1000) NOT NULL DEFAULT '',
         "hashtags" jsonb NOT NULL DEFAULT '[]',
         "poi_id" varchar(32) NOT NULL DEFAULT '',
         "poi_name" varchar(80) NOT NULL DEFAULT '',
         "xhs_title" varchar(20) NOT NULL DEFAULT '',
         "view_count" integer NOT NULL DEFAULT 0,
         "douyin_count" integer NOT NULL DEFAULT 0,
         "xhs_count" integer NOT NULL DEFAULT 0,
         "created_at" TIMESTAMP NOT NULL DEFAULT now(),
         "updated_at" TIMESTAMP NOT NULL DEFAULT now()
       )`,
    );
    await this.userRepo.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_publish_code_user" ON "publish_code" ("user_id")`,
    );
    await this.userRepo.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_publish_code_code" ON "publish_code" ("code")`,
    );
    await this.userRepo.query(
      `CREATE TABLE IF NOT EXISTS "video_example_reward" (
         "example_id" uuid PRIMARY KEY,
         "user_id" integer NOT NULL,
         "qualified_copies" integer NOT NULL DEFAULT 0,
         "rewarded_copies" integer NOT NULL DEFAULT 0
       )`,
    );
  }

  /**
   * 账单表原来只有一列「花费」（用户实付）：改名为 charge_cents，再补上上游成本和佣金列。
   * 旧账单没有成本数据，成本和佣金都记 0，利润统计从这次上线起才准确。
   */
  private async migrateUsageLog() {
    try {
      await this.userRepo.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'usage_log' AND column_name = 'cost_cents')
             AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'usage_log' AND column_name = 'charge_cents') THEN
            ALTER TABLE "usage_log" RENAME COLUMN "cost_cents" TO "charge_cents";
          END IF;
        END $$`);
      await this.userRepo.query(
        `ALTER TABLE IF EXISTS "usage_log"
           ADD COLUMN IF NOT EXISTS "upstream_cents" double precision NOT NULL DEFAULT 0,
           ADD COLUMN IF NOT EXISTS "commission_cents" double precision NOT NULL DEFAULT 0,
           ADD COLUMN IF NOT EXISTS "parent_commission_cents" double precision NOT NULL DEFAULT 0`,
      );
      await this.userRepo.query(
        `CREATE INDEX IF NOT EXISTS "IDX_usage_log_user_created" ON "usage_log" ("user_id", "created_at")`,
      );
    } catch (error) {
      this.logger.warn(`账单表升级失败：${error instanceof Error ? error.message : error}`);
    }
  }
}
