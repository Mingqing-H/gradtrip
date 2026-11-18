import { useMemo } from 'react';
import type { PlanningService, Trip, Workspace } from '../contracts/services';
import { getMemberProfileStatus } from '../domain/planning/profile';
import { getLedgerSummary } from '../domain/ledger/balances';
import { getItineraryBudget } from '../domain/itinerary/budget';

export function useNavigationSignals(trip: Trip | null, planning: PlanningService, today: string) {
  return useMemo<Record<Workspace, { text: string; pending: boolean }> | null>(() => {
    if (!trip) return null;
    const complete = trip.members.filter(member => getMemberProfileStatus(member) === 'complete').length;
    const confirmed = trip.confirmation ? planning.getConsensusStatus(trip, trip.confirmation.planId, today).confirmed : false;
    const ledger = getLedgerSummary(trip.members.map(member => member.id), trip.expenses, trip.settlements);
    const budget = getItineraryBudget({ activities: trip.itinerary.activities, members: [], planActivitiesEstimate: 0, baseEstimates: {} });
    const outstanding = ledger.balances.some(row => row.balance !== 0);
    return {
      squad: { text: `${complete}/${trip.members.length} 资料完整`, pending: complete < trip.members.length },
      plans: { text: confirmed ? '已确认' : trip.confirmation ? '待重新确认' : '筹备中', pending: !confirmed },
      itinerary: { text: budget.unknownActivityCount ? `${budget.unknownActivityCount} 项待估算` : `${trip.itinerary.activities.length} 项安排`, pending: budget.unknownActivityCount > 0 },
      ledger: { text: ledger.expenseCount === 0 ? '暂无费用' : outstanding ? '未结清' : '已结清', pending: outstanding },
    };
  }, [trip, planning, today]);
}
