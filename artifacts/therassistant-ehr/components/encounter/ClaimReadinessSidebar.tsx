"use client";

export type ClaimReadinessCheck = {
  label: string;
  isComplete: boolean;
  required: boolean;
};

type Props = {
  checks: ClaimReadinessCheck[];
};

export default function ClaimReadinessSidebar(_props: Props) {
  return null;
}
