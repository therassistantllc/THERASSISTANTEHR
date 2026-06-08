import type { TelehealthPlatform } from "../config";
import { googleMeetAdapter } from "./googleMeet";
import type { TelehealthAdapter } from "./types";
import { zoomAdapter } from "./zoom";

export function pickAdapter(platform: TelehealthPlatform): TelehealthAdapter {
  if (platform === "zoom") return zoomAdapter;
  return googleMeetAdapter;
}

export * from "./types";
