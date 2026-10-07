import { opensAtMessage } from "@/lib/hours/availability";
import type { NextOpening } from "@/lib/hours/schedule";
import type { TranslateFn } from "@/lib/i18n/dictionaries";
import type { Formatters } from "@/lib/i18n/format";

/**
 * "Opens at 11:00 AM" / "Opens tomorrow at 11:00 AM" / "Opens Friday at 11:00 AM",
 * in the reader's language, for any page (server: getT(), client: useTranslation()).
 */
export function opensText(opening: NextOpening, t: TranslateFn, fmt: Pick<Formatters, "clock">): string {
  const { key, dayKey } = opensAtMessage(opening);
  return t(key, { time: fmt.clock(opening.time), ...(dayKey ? { day: t(dayKey) } : {}) });
}
