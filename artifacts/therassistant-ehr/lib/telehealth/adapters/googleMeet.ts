import type {
  AdapterAuth,
  CreateMeetingInput,
  CreateMeetingResult,
  GetMeetingResult,
  TelehealthAdapter,
  UpdateMeetingInput,
  UpdateMeetingResult,
} from "./types";
import { TelehealthAdapterError } from "./types";

const CAL_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

function isoEnd(startAt: string, minutes: number): string {
  const start = new Date(startAt);
  const end = new Date(start.getTime() + Math.max(1, Math.round(minutes)) * 60_000);
  return end.toISOString();
}

export const googleMeetAdapter: TelehealthAdapter = {
  platform: "google_meet",

  async createMeeting(auth: AdapterAuth, input: CreateMeetingInput): Promise<CreateMeetingResult> {
    const body = {
      summary: input.topic,
      start: { dateTime: input.startAt, timeZone: input.timezone ?? "UTC" },
      end: { dateTime: isoEnd(input.startAt, input.durationMinutes), timeZone: input.timezone ?? "UTC" },
      conferenceData: {
        createRequest: {
          requestId: `tel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    };
    const url = `${CAL_API}?conferenceDataVersion=1`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new TelehealthAdapterError(`Google Calendar createEvent failed: ${res.status} ${text}`, "google_meet");
    }
    const json = (await res.json()) as {
      id: string;
      hangoutLink?: string;
      conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
    };
    const videoEntry = json.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video");
    const joinUrl = json.hangoutLink ?? videoEntry?.uri ?? null;
    if (!joinUrl) {
      throw new TelehealthAdapterError("Google created event but returned no Meet link", "google_meet");
    }
    return {
      externalMeetingId: json.id,
      joinUrl,
      hostUrl: null,
      rawResponse: json,
    };
  },

  async updateMeeting(
    auth: AdapterAuth,
    externalMeetingId: string,
    input: UpdateMeetingInput,
  ): Promise<UpdateMeetingResult> {
    const body: Record<string, unknown> = {
      start: { dateTime: input.startAt, timeZone: input.timezone ?? "UTC" },
      end: { dateTime: isoEnd(input.startAt, input.durationMinutes), timeZone: input.timezone ?? "UTC" },
    };
    if (input.topic) body.summary = input.topic;
    const res = await fetch(`${CAL_API}/${encodeURIComponent(externalMeetingId)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new TelehealthAdapterError(`Google Calendar updateEvent failed: ${res.status} ${text}`, "google_meet");
    }
    const json = (await res.json()) as {
      id: string;
      hangoutLink?: string;
      conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
    };
    const videoEntry = json.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video");
    const joinUrl = json.hangoutLink ?? videoEntry?.uri ?? null;
    if (!joinUrl) {
      throw new TelehealthAdapterError("Google updated event but returned no Meet link", "google_meet");
    }
    return {
      externalMeetingId: json.id,
      joinUrl,
      hostUrl: null,
      rawResponse: json,
    };
  },

  async getMeeting(auth: AdapterAuth, externalMeetingId: string): Promise<GetMeetingResult> {
    const res = await fetch(`${CAL_API}/${encodeURIComponent(externalMeetingId)}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new TelehealthAdapterError(`Google getEvent failed: ${res.status} ${text}`, "google_meet");
    }
    const json = (await res.json()) as {
      id: string;
      hangoutLink?: string;
      conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
      status?: string;
    };
    const videoEntry = json.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video");
    const joinUrl = json.hangoutLink ?? videoEntry?.uri ?? "";
    return {
      externalMeetingId: json.id,
      joinUrl,
      hostUrl: null,
      status: json.status === "cancelled" ? "ended" : "scheduled",
      rawResponse: json,
    };
  },
};
