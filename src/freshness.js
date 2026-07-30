// Calculo de frescura de datos: cuando cerro un dia en una zona horaria dada y
// cuantas horas han pasado desde entonces. Usa Intl.DateTimeFormat para que sea
// correcto en los cambios de horario.

// 'YYYY-MM-DD' del dia actual en la zona indicada.
export function todayInTimezone(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

// 'YYYY-MM-DD' del dia anterior en la zona indicada.
export function yesterdayInTimezone(timeZone, now = new Date()) {
  return addDays(todayInTimezone(timeZone, now), -1);
}

// Aritmetica de fechas en espacio UTC puro, inmune a cambios de horario.
export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Desplazamiento en minutos de `timeZone` respecto a UTC en un instante dado.
function tzOffsetMinutes(timeZone, date) {
  const parts = {};
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;

  // Con hour12:false algunos motores devuelven '24' para medianoche.
  const hour = parts.hour === '24' ? '00' : parts.hour;

  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(hour), Number(parts.minute), Number(parts.second)
  );
  return (asIfUtc - date.getTime()) / 60000;
}

// Instante UTC correspondiente a las 00:00:00 de `dateStr` en `timeZone`.
// Dos pasadas: la primera estimacion puede caer al otro lado de un cambio de
// horario, la segunda lo corrige.
export function startOfDayUtc(dateStr, timeZone) {
  const naive = Date.parse(`${dateStr}T00:00:00Z`);
  const firstGuess = naive - tzOffsetMinutes(timeZone, new Date(naive)) * 60000;
  const refined = naive - tzOffsetMinutes(timeZone, new Date(firstGuess)) * 60000;
  return new Date(refined);
}

// Instante UTC en el que termino el dia `dateStr` en `timeZone`,
// es decir las 00:00 del dia siguiente.
export function dayCloseInstant(dateStr, timeZone) {
  return startOfDayUtc(addDays(dateStr, 1), timeZone);
}

// Horas transcurridas desde el cierre del dia `dateStr` en `timeZone`.
// Negativo si el dia todavia no ha cerrado.
export function hoursSinceClose(dateStr, timeZone, now = new Date()) {
  return (now.getTime() - dayCloseInstant(dateStr, timeZone).getTime()) / 3600000;
}
