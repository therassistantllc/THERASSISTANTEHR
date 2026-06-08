import { makeLiveQueueGet } from "@/lib/billing/liveQueueRoute";

export const { GET } = makeLiveQueueGet("payer-rejections");
