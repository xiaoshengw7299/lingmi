import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

export const SHANGHAI_TZ = 'Asia/Shanghai';

export function shanghaiNow() {
  return dayjs().tz(SHANGHAI_TZ);
}

export function shanghaiDayStart(offsetDays = 0) {
  return shanghaiNow().add(offsetDays, 'day').startOf('day').toDate();
}

export function shanghaiYmd(offsetDays = 0) {
  return shanghaiNow().add(offsetDays, 'day').format('YYYY-MM-DD');
}

export function shanghaiDayBounds(billDate: string) {
  const start = dayjs.tz(`${billDate} 00:00:00`, SHANGHAI_TZ).toDate();
  const end = dayjs.tz(`${billDate} 23:59:59.999`, SHANGHAI_TZ).toDate();
  return { start, end };
}
