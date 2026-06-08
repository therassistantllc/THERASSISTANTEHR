import { makeLiveQueueUndo } from "@/lib/billing/liveQueueRoute";

export const { POST } = makeLiveQueueUndo("audit-queue");
