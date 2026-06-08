import type { TelehealthPlatform } from "../config";

export type CreateMeetingInput = {
  topic: string;
  startAt: string;
  durationMinutes: number;
  timezone?: string;
  hostEmail?: string | null;
};

export type CreateMeetingResult = {
  externalMeetingId: string;
  joinUrl: string;
  hostUrl: string | null;
  rawResponse: unknown;
};

export type GetMeetingResult = {
  externalMeetingId: string;
  joinUrl: string;
  hostUrl: string | null;
  status: "scheduled" | "live" | "ended" | "unknown";
  rawResponse: unknown;
};

export type UpdateMeetingInput = {
  topic?: string;
  startAt: string;
  durationMinutes: number;
  timezone?: string;
};

export type UpdateMeetingResult = {
  externalMeetingId: string;
  joinUrl: string;
  hostUrl: string | null;
  rawResponse: unknown;
};

export type AdapterAuth = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  accountEmail: string | null;
};

export interface TelehealthAdapter {
  readonly platform: TelehealthPlatform;
  createMeeting(auth: AdapterAuth, input: CreateMeetingInput): Promise<CreateMeetingResult>;
  getMeeting(auth: AdapterAuth, externalMeetingId: string): Promise<GetMeetingResult>;
  /**
   * Optional in-place reschedule. Adapters that cannot reliably update
   * an existing meeting should leave this undefined; callers will then
   * fall back to recreate-and-archive.
   */
  updateMeeting?(
    auth: AdapterAuth,
    externalMeetingId: string,
    input: UpdateMeetingInput,
  ): Promise<UpdateMeetingResult>;
}

export class TelehealthAdapterError extends Error {
  constructor(
    message: string,
    public readonly platform: TelehealthPlatform,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TelehealthAdapterError";
  }
}
