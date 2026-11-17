import { readFile } from 'node:fs/promises';
const required = {
  'src/features/squad/index.ts': ['SquadPage'], 'src/features/plans/index.ts': ['PlansPage'],
  'src/features/itinerary/index.ts': ['ItineraryPage'], 'src/features/ledger/index.ts': ['LedgerPage'],
  'src/features/sharing/index.ts': ['SnapshotPage', 'JoinPage', 'ResponsePage', 'SharingPanels'],
  'src/domain/planning/index.ts': ['applyPlanningCommand', 'validatePlanningTrip', 'planningService'],
  'src/domain/itinerary/index.ts': ['buildTemplateItinerary'],
  'src/domain/ledger/index.ts': ['applyItineraryLedgerCommand', 'validateItineraryLedgerTrip'],
  'src/domain/sharing/index.ts': ['applySharingCommand', 'validateSharingTrip'],
};
for (const [file, exports] of Object.entries(required)) {
  try {
    const source = await readFile(file, 'utf8');
    for (const name of exports) if (!source.includes(name)) throw new Error(`Missing export ${name}`);
  } catch (error) { console.error(`${file}: ${error.message}`); process.exitCode = 1; }
}
if (!process.exitCode) console.log('All required module entry points are present; runtime integration must also pass E2E.');
