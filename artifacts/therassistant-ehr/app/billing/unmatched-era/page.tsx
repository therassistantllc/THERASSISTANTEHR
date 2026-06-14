import ClaimlessEraMatchLinks from "./ClaimlessEraMatchLinks";
import UnmatchedEraClient from "./UnmatchedEraClient";

export const dynamic = "force-dynamic";

export default function UnmatchedEraPage() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <ClaimlessEraMatchLinks />
      <UnmatchedEraClient />
    </div>
  );
}
