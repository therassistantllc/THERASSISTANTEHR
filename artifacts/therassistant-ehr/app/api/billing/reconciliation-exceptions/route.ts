import { makeLiveQueueGet } from "@/lib/billing/liveQueueRoute";

export const { GET } = makeLiveQueueGet("reconciliation-exceptions");
