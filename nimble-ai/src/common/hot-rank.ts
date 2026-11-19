import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/** 列表排序：hot=综合（热度高的在前），new=最新发布 */
export type RankSort = 'hot' | 'new';

/**
 * 综合热度 = (复制数×5 + 查看数 + 1) / (发布小时数 + 2)^1.2
 * 复制比查看更能说明内容有用，所以权重更高；时间衰减让新内容有机会上榜，老内容不会永远霸榜。
 * 在 SQL 里实时计算，不存冗余字段，计数变化后排序自然更新。
 */
export const hotScoreSql = (alias: string) =>
  `((${alias}.copy_count * 5 + ${alias}.view_count + 1) / POWER(EXTRACT(EPOCH FROM (NOW() - ${alias}.created_at)) / 3600 + 2, 1.2))`;

/** 给单表查询加上排序与分页；单表分页必须用 offset/limit，skip/take 遇到表达式排序会出错 */
export function applyRank<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  sort: RankSort | undefined,
  page: number,
  pageSize: number,
): SelectQueryBuilder<T> {
  if (sort === 'new') qb.orderBy(`${alias}.created_at`, 'DESC');
  else qb.orderBy(hotScoreSql(alias), 'DESC').addOrderBy(`${alias}.created_at`, 'DESC');
  return qb.offset((page - 1) * pageSize).limit(pageSize);
}

/** 统一的分页参数解析（query 里是字符串） */
export function parsePage(page?: string | number, pageSize?: string | number, maxSize = 50) {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(maxSize, Math.max(1, Number(pageSize) || 20));
  return { page: p, pageSize: s };
}
