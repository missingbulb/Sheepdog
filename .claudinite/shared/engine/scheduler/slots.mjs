// Due-slot math for the vendored hourly scheduler (per-project-scheduling
// DESIGN §3). Pure and stateless: given the repo's `schedule` anchor, the
// frequencies its tasks declare, the current time `now`, and the timestamp
// `lastSuccess` of the scheduler's last SUCCESSFUL run (read from the Actions
// run ledger GitHub already keeps — there is no watermark file to corrupt),
// this decides exactly which frequencies are due and the slot id each is
// running under.

export const FREQUENCIES = ['hourly', 'daily-2h', 'daily-1h', 'daily', 'daily+1h', 'weekly', 'monthly'];

export const DEFAULT_SCHEDULE = { dailyHour: 4, weeklyDay: 'Sun', monthlyDay: 1 };

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DAILY_OFFSETS = { 'daily-2h': -2, 'daily-1h': -1, daily: 0, 'daily+1h': 1 };

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

const daysInMonth = (year, monthIndex) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

export function normalizeSchedule(schedule = {}) {
  const s = schedule || {};
  return {
    dailyHour: Number.isInteger(s.dailyHour) ? s.dailyHour : DEFAULT_SCHEDULE.dailyHour,
    weeklyDay: WEEKDAYS.includes(s.weeklyDay) ? s.weeklyDay : DEFAULT_SCHEDULE.weeklyDay,
    monthlyDay: Number.isInteger(s.monthlyDay) ? s.monthlyDay : DEFAULT_SCHEDULE.monthlyDay,
  };
}

export function mostRecentSlot(frequency, schedule, now) {
  const s = normalizeSchedule(schedule);
  now = new Date(now);
  const nowMs = now.getTime();

  if (frequency === 'hourly') {
    const time = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
    return { time, id: `h${ymd(time)}T${pad(time.getUTCHours())}Z` };
  }

  if (frequency in DAILY_OFFSETS) {
    const off = DAILY_OFFSETS[frequency];
    let anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    for (;;) {
      const time = new Date(anchor.getTime() + (s.dailyHour + off) * HOUR_MS);
      if (time.getTime() <= nowMs) return { time, id: `d${ymd(anchor)}` };
      anchor = new Date(anchor.getTime() - DAY_MS);
    }
  }

  if (frequency === 'weekly') {
    const targetDow = WEEKDAYS.indexOf(s.weeklyDay);
    let date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    for (let i = 0; i < 8; i += 1) {
      if (date.getUTCDay() === targetDow) {
        const time = new Date(date.getTime() + s.dailyHour * HOUR_MS);
        if (time.getTime() <= nowMs) return { time, id: `w${ymd(date)}` };
      }
      date = new Date(date.getTime() - DAY_MS);
    }
    throw new Error(`no weekly slot resolved for ${s.weeklyDay}`);
  }

  if (frequency === 'monthly') {
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth();
    for (;;) {
      const day = Math.min(s.monthlyDay, daysInMonth(year, month));
      const time = new Date(Date.UTC(year, month, day) + s.dailyHour * HOUR_MS);
      if (time.getTime() <= nowMs) return { time, id: `m${year}-${pad(month + 1)}` };
      month -= 1;
      if (month < 0) { month = 11; year -= 1; }
    }
  }

  throw new Error(`unknown frequency "${frequency}"`);
}

export function dueSlots(frequencies, schedule, now, lastSuccess) {
  const s = normalizeSchedule(schedule);
  now = new Date(now);
  const nowMs = now.getTime();
  const tMs = lastSuccess === null || lastSuccess === undefined ? null : new Date(lastSuccess).getTime();

  const out = [];
  for (const frequency of frequencies) {
    if (!FREQUENCIES.includes(frequency)) continue;
    const slot = mostRecentSlot(frequency, s, now);
    const t = slot.time.getTime();
    const due = tMs === null ? t <= nowMs : t > tMs && t <= nowMs;
    if (due) out.push({ frequency, slotId: slot.id, slotTime: slot.time.toISOString() });
  }
  return out;
}
