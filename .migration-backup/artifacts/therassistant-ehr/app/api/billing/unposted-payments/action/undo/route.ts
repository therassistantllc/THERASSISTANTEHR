import { makeLiveQueueUndo } from "@/lib/billing/liveQueueRoute";

export const { POST } = makeLiveQueueUndo("unposted-payments");
