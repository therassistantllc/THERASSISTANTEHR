import PatientBalanceClient from "@/app/patients/[clientId]/balance/PatientBalanceClient";

export default async function ClientBalancePage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;

	return (
		<main className="app-shell">
			<PatientBalanceClient clientId={id} />
		</main>
	);
}
