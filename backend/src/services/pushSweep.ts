/**
 * Push sweep
 *
 * A post moves on in the request that casts the deciding vote (routes/push.ts). This timer is
 * the safety net for what no vote announces; see sweepPushes in groupService.ts.
 */

import { sweepPushes } from './groupService';
import { recalculateAllGroupWeights } from './groupWeightService';
import { recalculateAllMemberWeights } from './memberWeightService';
import { recalculateAllSpreads } from './spreadService';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
// Soon after starting, for a move that the previous run did not get to finish.
// SWEEP_START_DELAY_SECONDS lets the API test keep it out of the way.
const FIRST_SWEEP_DELAY_MS = (Number(process.env.SWEEP_START_DELAY_SECONDS) || 30) * 1000;

/** One run: also started by an admin from the admin page, and after an admin changes a rule. */
export function recalculateEverything(): Promise<void> {
  return sweepPushes()
    .then((moved) => {
      if (moved > 0) console.log(`Push sweep moved ${moved} post(s)`);
    })
    // Group weights follow the members' days of use, which no request announces.
    .then(() => recalculateAllGroupWeights())
    .then(() => recalculateAllMemberWeights())
    // The number of eligible groups changes as groups fill up; the common page follows it.
    .then(() => recalculateAllSpreads());
}

export function startPushSweep(): void {
  const run = () => {
    void recalculateEverything();
  };
  setTimeout(run, FIRST_SWEEP_DELAY_MS);
  setInterval(run, SWEEP_INTERVAL_MS);
  console.log('Push sweep started (hourly)');
}
