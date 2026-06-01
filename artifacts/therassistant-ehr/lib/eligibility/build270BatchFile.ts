type Eligibility270Candidate = {
  appointmentId: string | null;
  clientId: string;
  insurancePolicyId: string;
  payerId: string | null;
  payerName: string;
  electronicPayerId: string;
  serviceDate: string;
  clientFirstName: string;
  clientLastName: string;
  clientDob: string;
  subscriberFirstName: string;
  subscriberLastName: string;
  subscriberDob: string;
  subscriberMemberId: string;
  relationshipToClient: string | null;
  traceNumber: string;
};

type Build270Options = {
  batchNumber: string;
  senderId: string;
  receiverId: string;
  billingProviderName: string;
  billingProviderNpi: string;
  candidates: Eligibility270Candidate[];
  usageIndicator?: "T" | "P";
};

function clean(value: unknown, max = 60) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 .,&'\/-]/g, "")
    .trim()
    .slice(0, max);
}

function compactDate(value: string | null | undefined) {
  return String(value ?? "").replace(/-/g, "").slice(0, 8);
}

function pad(value: string, length: number) {
  return value.padEnd(length, " ").slice(0, length);
}

function controlNumberFromBatch(batchNumber: string) {
  const digits = batchNumber.replace(/\D/g, "").slice(-9);
  return digits.padStart(9, "0") || "000000001";
}

export function build270BatchFile(options: Build270Options) {
  if (!options.candidates.length) throw new Error("At least one eligibility request is required");
  const now = new Date();
  const yyMMdd = now.toISOString().slice(2, 10).replace(/-/g, "");
  const yyyyMMdd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const hhmm = now.toISOString().slice(11, 16).replace(":", "");
  const interchangeControl = controlNumberFromBatch(options.batchNumber);
  const groupControl = String(Number(interchangeControl)).padStart(1, "0");
  const stControl = "0001";
  const usage = options.usageIndicator ?? "T";
  const sender = clean(options.senderId || "THERASSISTANT", 15);
  const receiver = clean(options.receiverId || "AVAILITY", 15);
  const providerName = clean(options.billingProviderName || "BILLING PROVIDER", 35);
  const providerNpi = clean(options.billingProviderNpi || "0000000000", 10);

  const segments: string[] = [];
  segments.push(`ISA*00*          *00*          *ZZ*${pad(sender, 15)}*ZZ*${pad(receiver, 15)}*${yyMMdd}*${hhmm}*^*00501*${interchangeControl}*0*${usage}*:`);
  segments.push(`GS*HS*${sender}*${receiver}*${yyyyMMdd}*${hhmm}*${groupControl}*X*005010X279A1`);
  segments.push(`ST*270*${stControl}*005010X279A1`);
  segments.push(`BHT*0022*13*${clean(options.batchNumber, 30)}*${yyyyMMdd}*${hhmm}`);
  segments.push("HL*1**20*1");

  const first = options.candidates[0];
  segments.push(`NM1*PR*2*${clean(first.payerName || "PAYER", 35)}*****PI*${clean(first.electronicPayerId, 80)}`);
  segments.push("HL*2*1*21*1");
  segments.push(`NM1*1P*2*${providerName}*****XX*${providerNpi}`);

  let hl = 3;
  for (const c of options.candidates) {
    const patientIsSubscriber = !c.relationshipToClient || ["self", "18", "subscriber"].includes(c.relationshipToClient.toLowerCase());
    if (patientIsSubscriber) {
      segments.push(`HL*${hl}*2*22*0`);
      segments.push(`TRN*1*${clean(c.traceNumber, 50)}`);
      segments.push(`NM1*IL*1*${clean(c.subscriberLastName, 35)}*${clean(c.subscriberFirstName, 25)}****MI*${clean(c.subscriberMemberId, 80)}`);
      segments.push(`DMG*D8*${compactDate(c.subscriberDob)}`);
      segments.push(`DTP*291*D8*${compactDate(c.serviceDate)}`);
      segments.push("EQ*98");
      hl += 1;
    } else {
      const subscriberHl = hl++;
      const dependentHl = hl++;
      segments.push(`HL*${subscriberHl}*2*22*1`);
      segments.push(`TRN*1*${clean(c.traceNumber, 50)}`);
      segments.push(`NM1*IL*1*${clean(c.subscriberLastName, 35)}*${clean(c.subscriberFirstName, 25)}****MI*${clean(c.subscriberMemberId, 80)}`);
      segments.push(`DMG*D8*${compactDate(c.subscriberDob)}`);
      segments.push(`HL*${dependentHl}*${subscriberHl}*23*0`);
      segments.push(`NM1*03*1*${clean(c.clientLastName, 35)}*${clean(c.clientFirstName, 25)}`);
      segments.push(`DMG*D8*${compactDate(c.clientDob)}`);
      segments.push(`DTP*291*D8*${compactDate(c.serviceDate)}`);
      segments.push("EQ*98");
    }
  }

  const seCount = segments.length - 2 + 2;
  segments.push(`SE*${seCount}*${stControl}`);
  segments.push(`GE*1*${groupControl}`);
  segments.push(`IEA*1*${interchangeControl}`);

  return segments.join("~\n") + "~\n";
}
