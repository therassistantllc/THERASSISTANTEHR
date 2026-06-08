import { makeLiveQueueAction } from "@/lib/billing/liveQueueRoute";

export const { POST } = makeLiveQueueAction("adjustments-review");
