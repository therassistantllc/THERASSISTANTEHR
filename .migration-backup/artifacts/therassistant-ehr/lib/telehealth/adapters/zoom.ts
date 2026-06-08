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

const ZOOM_API = "https://api.zoom.us/v2";

export const zoomAdapter: TelehealthAdapter = {
  platform: "zoom",

  async createMeeting(auth: AdapterAuth, input: CreateMeetingInput): Promise<CreateMeetingResult> {
    const body = {
      topic: input.topic,
      type: 2,
      start_time: input.startAt,
      duration: Math.max(1, Math.round(input.durationMinutes)),
      timezone: input.timezone ?? "UTC",
      settings: {
        waiting_room: true,
        join_before_host: false,
        host_video: true,
        participant_video: false,
        mute_upon_entry: true,
      },
    };
    const res = await fetch(`${ZOOM_API}/users/me/meetings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new TelehealthAdapterError(`Zoom createMeeting failed: ${res.status} ${text}`, "zoom");
    }
    const json = (await res.json()) as {
      id: number | string;
      join_url: string;
      start_url?: string;
    };
    return {
      externalMeetingId: String(json.id),
      joinUrl: json.join_url,
      hostUrl: json.start_url ?? null,
      rawResponse: json,
    };
  },

  async updateMeeting(
    auth: AdapterAuth,
    externalMeetingId: string,
    input: UpdateMeetingInput,
  ): Promise<UpdateMeetingResult> {
    const body: Record<string, unknown> = {
      start_time: input.startAt,
      duration: Math.max(1, Math.round(input.durationMinutes)),
      timezone: input.timezone ?? "UTC",
    };
    if (input.topic) body.topic = input.topic;
    const res = await fetch(`${ZOOM_API}/meetings/${encodeURIComponent(externalMeetingId)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new TelehealthAdapterError(`Zoom updateMeeting failed: ${res.status} ${text}`, "zoom");
    }
    // Zoom returns 204 No Content on PATCH; re-fetch to surface join_url.
    const fetched = await fetch(`${ZOOM_API}/meetings/${encodeURIComponent(externalMeetingId)}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    if (!fetched.ok) {
      const text = await fetched.text();
      throw new TelehealthAdapterError(`Zoom updateMeeting re-fetch failed: ${fetched.status} ${text}`, "zoom");
    }
    const json = (await fetched.json()) as {
      id: number | string;
      join_url: string;
      start_url?: string;
    };
    return {
      externalMeetingId: String(json.id),
      joinUrl: json.join_url,
      hostUrl: json.start_url ?? null,
      rawResponse: json,
    };
  },

  async getMeeting(auth: AdapterAuth, externalMeetingId: string): Promise<GetMeetingResult> {
    const res = await fetch(`${ZOOM_API}/meetings/${encodeURIComponent(externalMeetingId)}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new TelehealthAdapterError(`Zoom getMeeting failed: ${res.status} ${text}`, "zoom");
    }
    const json = (await res.json()) as {
      id: number | string;
      join_url: string;
      start_url?: string;
      status?: string;
    };
    const status =
      json.status === "started"
        ? "live"
        : json.status === "finished"
          ? "ended"
          : json.status === "waiting"
            ? "scheduled"
            : "unknown";
    return {
      externalMeetingId: String(json.id),
      joinUrl: json.join_url,
      hostUrl: json.start_url ?? null,
      status,
      rawResponse: json,
    };
  },
};
