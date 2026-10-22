import ClinicResourceCalendar from './ClinicResourceCalendar';
import LegacyBookingCalendar from './LegacyBookingCalendar';

interface Props {
  onSelect?: (startsAt: string) => void;
}

export default function BookingCalendarPage({ onSelect }: Props = {}) {
  // Keep the embedded new-lead form compatible until its booking path is migrated.
  if (onSelect) {
    return <LegacyBookingCalendar onSelect={onSelect} />;
  }

  return <ClinicResourceCalendar />;
}
