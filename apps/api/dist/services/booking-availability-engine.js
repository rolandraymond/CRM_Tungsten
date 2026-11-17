import { DateTime } from 'luxon';
const TIMEZONE = 'Africa/Cairo';
export class AvailabilityError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
export function getAvailabilityRange(date) {
    const day = DateTime.fromISO(date, { zone: TIMEZONE });
    if (!day.isValid || day.toISODate() !== date) {
        throw new AvailabilityError('INVALID_BOOKING_DATE');
    }
    const start = day.startOf('day');
    const end = start.plus({ days: 1 });
    return {
        day: start,
        start: start.toUTC().toISO(),
        // A session starting late on this date may continue into the next day.
        end: end.plus({ minutes: 1440 }).toUTC().toISO(),
    };
}
function timestamp(value) {
    const time = DateTime.fromISO(value, { setZone: true });
    if (!time.isValid) {
        throw new AvailabilityError('INVALID_RESOURCE_TIME');
    }
    return time.toMillis();
}
function overlaps(first, second) {
    return first.start < second.end && second.start < first.end;
}
function mergeIntervals(intervals) {
    const sorted = intervals.slice().sort((a, b) => a.start - b.start);
    const merged = [];
    for (const interval of sorted) {
        const previous = merged[merged.length - 1];
        if (previous && interval.start <= previous.end) {
            previous.end = Math.max(previous.end, interval.end);
        }
        else {
            merged.push({ ...interval });
        }
    }
    return merged;
}
function subtractIntervals(working, blocked) {
    let remaining = working;
    for (const block of mergeIntervals(blocked)) {
        const next = [];
        for (const period of remaining) {
            if (!overlaps(period, block)) {
                next.push(period);
                continue;
            }
            if (period.start < block.start) {
                next.push({ start: period.start, end: block.start });
            }
            if (period.end > block.end) {
                next.push({ start: block.end, end: period.end });
            }
        }
        remaining = next;
    }
    return remaining;
}
function shiftTime(day, clock) {
    const local = `${day.toISODate()}T${clock}`;
    const time = DateTime.fromISO(local, { zone: TIMEZONE });
    const expectedClock = clock.slice(0, 8).padEnd(8, ':00');
    if (!time.isValid ||
        time.toISODate() !== day.toISODate() ||
        time.toFormat('HH:mm:ss') !== expectedClock ||
        time.getPossibleOffsets().length !== 1) {
        throw new AvailabilityError('INVALID_OR_AMBIGUOUS_SCHEDULE_TIME');
    }
    return time.toMillis();
}
function doctorWorkingTime(doctorId, day, data) {
    const intervals = [];
    // Include previous-day overnight work and next-day continuous work.
    for (const offset of [-1, 0, 1]) {
        const shiftDay = day.plus({ days: offset });
        for (const period of data.periods) {
            if (period.doctor_id !== doctorId ||
                !period.is_active ||
                period.iso_weekday !== shiftDay.weekday) {
                continue;
            }
            const start = shiftTime(shiftDay, period.starts_at);
            const end = shiftTime(shiftDay.plus({ days: period.end_day_offset }), period.ends_at);
            if (end <= start) {
                throw new AvailabilityError('INVALID_WORKING_PERIOD');
            }
            intervals.push({ start, end });
        }
    }
    const blocked = data.blocks
        .filter((block) => block.doctor_id === doctorId)
        .map((block) => ({
        start: timestamp(block.starts_at),
        end: timestamp(block.ends_at),
    }));
    return subtractIntervals(mergeIntervals(intervals), blocked);
}
function eligibleDeviceIds(doctorId, serviceId, data) {
    const activeDevices = new Set(data.devices.filter((device) => device.is_active).map((device) => device.id));
    const serviceDevices = new Set(data.serviceDevices
        .filter((link) => link.service_id === serviceId && link.is_active)
        .map((link) => link.device_id));
    return [
        ...new Set(data.doctorDevices
            .filter((link) => link.doctor_id === doctorId &&
            link.service_id === serviceId &&
            link.is_active &&
            activeDevices.has(link.device_id) &&
            serviceDevices.has(link.device_id))
            .map((link) => link.device_id)),
    ].sort();
}
export function buildResourceAvailability(input) {
    const { day } = getAvailabilityRange(input.date);
    const dayStart = day.toMillis();
    const dayEnd = day.plus({ days: 1 }).toMillis();
    const now = input.now ?? Date.now();
    const slots = [];
    // Legacy appointments have no scheduling doctor. Do not guess their owner.
    if (input.data.appointments.some((appointment) => !appointment.resource_doctor_id)) {
        throw new AvailabilityError('UNASSIGNED_APPOINTMENTS');
    }
    const reservations = input.data.appointments.map((appointment) => {
        if (!appointment.ends_at) {
            throw new AvailabilityError('APPOINTMENT_END_REQUIRED');
        }
        return {
            doctorId: appointment.resource_doctor_id,
            deviceId: appointment.device_id,
            start: timestamp(appointment.starts_at),
            end: timestamp(appointment.ends_at),
        };
    });
    for (const doctor of input.data.doctors) {
        if (!doctor.is_active || (input.doctorId && doctor.id !== input.doctorId)) {
            continue;
        }
        const offering = input.data.offerings.find((row) => row.doctor_id === doctor.id &&
            row.service_id === input.serviceId &&
            row.is_active);
        if (!offering) {
            continue;
        }
        const deviceIds = input.requiresDevice
            ? eligibleDeviceIds(doctor.id, input.serviceId, input.data)
            : [];
        if (input.requiresDevice && deviceIds.length === 0) {
            continue;
        }
        const duration = offering.duration_minutes * 60_000;
        const working = doctorWorkingTime(doctor.id, day, input.data);
        for (const period of working) {
            for (let start = period.start; start + duration <= period.end; start += duration) {
                if (start < dayStart || start >= dayEnd || start < now) {
                    continue;
                }
                const candidate = { start, end: start + duration };
                const conflicts = reservations.filter((row) => overlaps(candidate, row));
                if (conflicts.some((row) => row.doctorId === doctor.id)) {
                    continue;
                }
                const freeDevices = deviceIds.filter((deviceId) => !conflicts.some((row) => row.deviceId === deviceId));
                if (input.requiresDevice && freeDevices.length === 0) {
                    continue;
                }
                slots.push({
                    doctor_id: doctor.id,
                    doctor_name: doctor.full_name,
                    duration_minutes: offering.duration_minutes,
                    starts_at: DateTime.fromMillis(start).toUTC().toISO(),
                    ends_at: DateTime.fromMillis(candidate.end).toUTC().toISO(),
                    device_ids: freeDevices,
                });
                if (slots.length > 20_000) {
                    throw new AvailabilityError('AVAILABILITY_TOO_LARGE');
                }
            }
        }
    }
    return slots.sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.doctor_id.localeCompare(b.doctor_id));
}
//# sourceMappingURL=booking-availability-engine.js.map