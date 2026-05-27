"use client";

import dynamic from "next/dynamic";

const MonthCalendarClient = dynamic(() => import("./MonthCalendarClient"), {
  ssr: false,
});

export default function CalendarClientOnly() {
  return <MonthCalendarClient />;
}