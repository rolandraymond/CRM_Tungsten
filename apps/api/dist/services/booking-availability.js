import { DateTime } from 'luxon';
const ZONE = 'Africa/Cairo';
function iso(value) {
    const result = value.toUTC().toISO();
    if (!result) {
        throw new Error('Invalid booking date');
    }
    return result;
}
function readTime(value) {
    const match = /^(\d{2}):(\d{2})(?::00(?:\.0+)?)?$/.exec(value);
    if (!match) {
        throw new Error('Invalid clinic working time');
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) {
        throw new Error('Invalid clinic working time');
    }
    return hour * 60 + minute;
}
function validateSettings(settings) {
    if (settings.timezone !== ZONE ||
        ![10, 20, 30, 60].includes(settings.slot_minutes) ||
        !Number.isInteger(settings.slot_capacity) ||
        settings.slot_capacity < 1 ||
        settings.slot_capacity > 100 ||
        settings.working_days.some(day => !Number.isInteger(day) || day < 1 || day > 7)) {
        throw new Error('Invalid clinic booking settings');
    }
    if (readTime(settings.opens_at) === readTime(settings.closes_at)) {
        throw new Error('Clinic opening and closing times must differ');
    }
}
/**
 * Resolve a Cairo wall-clock time.
 * Reject nonexistent times during daylight-saving transitions.
 * Return both possibilities when a clock time occurs twice.
 */
function wallTimes(day, minutes) {
    const date = day.plus({ days: Math.floor(minutes / 1440) });
    const minuteOfDay = minutes % 1440;
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    const value = DateTime.fromObject({
        year: date.year,
        month: date.month,
        day: date.day,
        hour,
        minute,
        second: 0,
        millisecond: 0,
    }, { zone: ZONE });
    if (!value.isValid ||
        value.year !== date.year ||
        value.month !== date.month ||
        value.day !== date.day ||
        value.hour !== hour ||
        value.minute !== minute) {
        return [];
    }
    return value
        .getPossibleOffsets()
        .sort((a, b) => a.toMillis() - b.toMillis());
}
/**
 * Count values strictly before the given timestamp.
 */
function countBefore(values, target) {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (values[middle] < target) {
            low = middle + 1;
        }
        else {
            high = middle;
        }
    }
    return low;
}
/**
 * Count values at or before the given timestamp.
 */
function countThrough(values, target) {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (values[middle] <= target) {
            low = middle + 1;
        }
        else {
            high = middle;
        }
    }
    return low;
}
export function getBookingMonthRange(month) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
        throw new Error('Month must use YYYY-MM format');
    }
    const start = DateTime.fromISO(`${month}-01`, { zone: ZONE });
    if (!start.isValid || start.toFormat('yyyy-MM') !== month) {
        throw new Error('Invalid booking month');
    }
    return {
        start: iso(start.startOf('month')),
        end: iso(start.startOf('month').plus({ months: 1 })),
    };
}
export function buildBookingMonth(month, settings, appointments, now = DateTime.now()) {
    getBookingMonthRange(month);
    if (settings) {
        validateSettings(settings);
    }
    const firstDay = DateTime.fromISO(`${month}-01`, { zone: ZONE });
    const dayCount = firstDay.daysInMonth;
    if (!dayCount) {
        throw new Error('Invalid booking month');
    }
    const currentTime = now.toMillis();
    const duration = settings?.slot_minutes ?? 30;
    const capacity = settings?.slot_capacity ?? 1;
    const clientsByDay = new Map();
    const occupied = [];
    for (const appointment of appointments) {
        if (appointment.archived_at !== null ||
            appointment.status === 'cancelled') {
            continue;
        }
        const start = DateTime.fromISO(appointment.starts_at, {
            setZone: true,
        });
        if (!start.isValid) {
            throw new Error('Invalid appointment start time');
        }
        const date = start.setZone(ZONE).toFormat('yyyy-MM-dd');
        const clients = clientsByDay.get(date) ?? new Set();
        clients.add(appointment.contact_id);
        clientsByDay.set(date, clients);
        // Legacy appointments may not have an end time.
        const end = appointment.ends_at
            ? DateTime.fromISO(appointment.ends_at, { setZone: true })
            : start.plus({ minutes: duration });
        if (!end.isValid || end.toMillis() <= start.toMillis()) {
            throw new Error('Invalid appointment end time');
        }
        occupied.push({
            start: start.toMillis(),
            end: end.toMillis(),
        });
    }
    const starts = occupied.map(item => item.start).sort((a, b) => a - b);
    const ends = occupied.map(item => item.end).sort((a, b) => a - b);
    const days = [];
    for (let index = 0; index < dayCount; index += 1) {
        const day = firstDay.plus({ days: index });
        const date = day.toFormat('yyyy-MM-dd');
        const slotsByStart = new Map();
        if (settings?.enabled) {
            const opening = readTime(settings.opens_at);
            let closing = readTime(settings.closes_at);
            if (closing < opening) {
                closing += 1440;
            }
            // Include the previous day's overnight shift.
            for (const shiftDay of [day.minus({ days: 1 }), day]) {
                if (!settings.working_days.includes(shiftDay.weekday)) {
                    continue;
                }
                const closingTimes = wallTimes(shiftDay, closing);
                const shiftEnd = closingTimes[closingTimes.length - 1];
                if (!shiftEnd) {
                    continue;
                }
                for (let minute = opening; minute + duration <= closing; minute += duration) {
                    for (const start of wallTimes(shiftDay, minute)) {
                        if (start.toFormat('yyyy-MM-dd') !== date) {
                            continue;
                        }
                        const end = start.plus({ minutes: duration });
                        if (end.toMillis() > shiftEnd.toMillis()) {
                            continue;
                        }
                        const startMs = start.toMillis();
                        const endMs = end.toMillis();
                        // Overlap: appointment.start < slot.end
                        // and appointment.end > slot.start.
                        const bookedCount = countBefore(starts, endMs) -
                            countThrough(ends, startMs);
                        const remaining = Math.max(0, capacity - bookedCount);
                        const past = startMs <= currentTime;
                        const state = past
                            ? 'past'
                            : remaining === 0
                                ? 'full'
                                : bookedCount > 0
                                    ? 'limited'
                                    : 'available';
                        slotsByStart.set(startMs, {
                            starts_at: iso(start),
                            ends_at: iso(end),
                            local_time: start.toFormat('HH:mm'),
                            booked_count: bookedCount,
                            remaining_capacity: remaining,
                            capacity,
                            available: !past && remaining > 0,
                            state,
                        });
                    }
                }
            }
        }
        const slots = [...slotsByStart.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, slot]) => slot);
        const futureSlots = slots.filter(slot => slot.state !== 'past');
        const remainingCapacity = futureSlots.reduce((total, slot) => total + slot.remaining_capacity, 0);
        const availableSlots = futureSlots.filter(slot => slot.available).length;
        const state = slots.length === 0
            ? 'closed'
            : futureSlots.length === 0
                ? 'past'
                : availableSlots === 0
                    ? 'full'
                    : futureSlots.some(slot => slot.booked_count > 0)
                        ? 'limited'
                        : 'available';
        days.push({
            date,
            booked_clients: clientsByDay.get(date)?.size ?? 0,
            total_capacity: slots.length * capacity,
            remaining_capacity: remainingCapacity,
            available_slots: availableSlots,
            state,
            slots,
        });
    }
    return {
        month,
        timezone: ZONE,
        enabled: settings?.enabled ?? false,
        days,
    };
}
//# sourceMappingURL=booking-availability.js.map