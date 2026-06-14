"use client";

import dynamic from "next/dynamic";

const InteractiveCalendarClient = dynamic(() => import("./InteractiveCalendarClient"), {
  ssr: false,
});

export default function CalendarClientOnly() {
  return <InteractiveCalendarClient />;
}
