import { fetchFullDashboardData } from '@/lib/api/dashboard';
import { DashboardClientView } from './DashboardClientView';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dashboard | MERIDIAN',
  description: 'View real-time payroll metrics, focus session progression, and prize pool rankings.',
};

export default async function DashboardPage() {
  // Server-side prefetching for server-to-client handoff
  const initialData = await fetchFullDashboardData();

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">MERIDIAN Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Monitor your real-time earnings, focus stats, and pool progression.
        </p>
      </div>

      <DashboardClientView initialData={initialData} />
    </div>
  );
}
