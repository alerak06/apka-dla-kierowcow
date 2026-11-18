import { db } from 'hatchable';

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / DAY_MS);
}

// kiedy wypada nastepny serwis: z interwalu w km i/lub dniach
// i z tego, kiedy ostatnio byl robiony (albo od dodania auta)
export function nextDue({ intervalKm, intervalDays, lastKm, lastDate, currentKm, today, avgKmPerDay, plannedDate }) {
  const dueKm = intervalKm != null && lastKm != null ? lastKm + intervalKm : null;
  const dueDate = intervalDays != null && lastDate != null
    ? new Date(new Date(lastDate).getTime() + intervalDays * DAY_MS).toISOString().slice(0, 10)
    : null;

  const kmLeft = dueKm != null ? dueKm - currentKm : null;
  const daysLeft = dueDate != null ? daysBetween(today, dueDate) : null;

  // jak interwal jest tylko w km, to z tempa jazdy szacuje za ile dni.
  // jak nie ma historii przebiegu, zakladam ~35 km dziennie
  const rate = avgKmPerDay > 0 ? avgKmPerDay : 35;
  const daysFromKm = kmLeft != null ? Math.round(kmLeft / rate) : null;
  const effectiveDays = daysLeft != null
    ? (daysFromKm != null ? Math.min(daysLeft, daysFromKm) : daysLeft)
    : daysFromKm;

  let status = 'ok';
  if (kmLeft == null && daysLeft == null) {
    status = plannedDate ? 'planned' : 'ok';
  } else {
    const kmSoon = kmLeft != null && kmLeft <= Math.max(intervalKm ? intervalKm * 0.1 : 0, 1000);
    const daysSoon = effectiveDays != null && effectiveDays <= 30;
    const overdue = (kmLeft != null && kmLeft < 0) || (effectiveDays != null && effectiveDays < 0);
    if (overdue) status = 'overdue';
    else if (kmSoon || daysSoon) status = 'due';
    else if (plannedDate) status = 'planned';
  }

  return { dueKm, dueDate, kmLeft, daysLeft: effectiveDays, status };
}

function plDays(n) {
  return n === 1 ? 'dzień' : 'dni';
}

export function dueLabel(name, kmLeft, daysLeft) {
  const parts = [];
  if (kmLeft != null) parts.push(`${Math.abs(kmLeft).toLocaleString('pl-PL')} km`);
  if (daysLeft != null) parts.push(`${Math.abs(daysLeft)} ${plDays(Math.abs(daysLeft))}`);
  if (parts.length === 0) return `${name}: brak danych`;
  const joined = parts.join(' lub ');
  const overdue = (kmLeft != null && kmLeft < 0) || (daysLeft != null && daysLeft < 0);
  return overdue ? `${name}: spóźnione o ${joined}` : `${name}: za około ${joined}`;
}

// wszystkie przypomnienia dla jednego auta, uzywane przez codzienne zadanie w tle
export async function computeDues(car, today) {
  const odo = (await db.query(
    'SELECT km, recorded_at FROM odometer_entries WHERE car_id = $1 ORDER BY recorded_at ASC, id ASC',
    [car.id]
  )).rows;
  const first = odo[0];
  const latest = odo[odo.length - 1];
  const currentKm = latest?.km ?? car.initial_odometer;

  let avgKmPerDay = null;
  if (first && latest && first.recorded_at !== latest.recorded_at) {
    const days = Math.max(1, (new Date(latest.recorded_at) - new Date(first.recorded_at)) / DAY_MS);
    avgKmPerDay = (latest.km - first.km) / days;
  }

  const tasks = (await db.query(
    'SELECT * FROM service_tasks WHERE car_id = $1 AND archived = false AND reminder_enabled = true',
    [car.id]
  )).rows;

  // ostatni wpis serwisowy dla kazdego zadania
  const lastRecords = (await db.query(
    `SELECT DISTINCT ON (task_id) task_id, done_at, odometer_km
     FROM service_records
     WHERE car_id = $1 AND task_id IS NOT NULL
     ORDER BY task_id, done_at DESC, id DESC`,
    [car.id]
  )).rows;
  const lastByTask = new Map(lastRecords.map((r) => [r.task_id, r]));

  return tasks.map((t) => {
    const rec = lastByTask.get(t.id);
    const due = nextDue({
      intervalKm: t.interval_km,
      intervalDays: t.interval_days,
      lastKm: rec ? rec.odometer_km : car.initial_odometer,
      lastDate: rec ? rec.done_at : car.added_at?.toString().slice(0, 10),
      currentKm,
      today,
      avgKmPerDay,
      plannedDate: t.planned_date,
    });
    return { name: t.name, status: due.status, label: dueLabel(t.name, due.kmLeft, due.daysLeft) };
  });
}
