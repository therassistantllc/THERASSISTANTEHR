"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import SoapNoteEditor, { SoapNoteData } from "@/components/encounter/SoapNoteEditor";
import DiagnosisPicker, { Diagnosis } from "@/components/encounter/DiagnosisPicker";
import CptCodePanel, { ServiceLine } from "@/components/encounter/CptCodePanel";
import ClaimReadinessSidebar, { ClaimReadinessCheck } from "@/components/encounter/ClaimReadinessSidebar";
import SignNoteModal from "@/components/encounter/SignNoteModal";
import ClinicianJournalPanel, { ImportResult } from "@/components/encounter/ClinicianJournalPanel";
import CodingHelperPanel, { CodingHelperReport } from "@/components/encounter/CodingHelperPanel";
import { buildCodingReport } from "@/components/encounter/coding-helper/buildCodingReport";
import { scoreCodingQuestionnaire } from "@/components/encounter/coding-helper/scoring";
import { DEFAULT_ORG_ID } from "@/lib/config";
import { analyzeMedicaidDocumentation } from "@/lib/encounters/medicaidCodeDetection";
import {
  CHECK_IN_SUBJECTIVE_MARKER,
  composeCheckInSubjectiveBlock,
  mergeCheckInIntoSubjective,
} from "@/lib/checkIns/welcomeFocus";

// NOTE: This file is intentionally left in-place. The API backing this panel now
// returns only the most recent encounter coding_report document, so the former
// Mailroom Documents section is now a single Coding Report panel in the UI.

export { default } from "./EncounterNoteClient";
