/**
 * Push sweep
 *
 * A post moves on in the request that casts the deciding vote (routes/push.ts). This timer is
 * the safety net for what no vote announces; see sweepPushes in groupService.ts.
 */

import { sweepPushes } from './groupService';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
// Soon after starting, for a move that the previous run did not get to finish.
const FIRST_SWEEP_DELAY_MS = 30 * 1000;

export function startPushSweep(): void {
  const run = () => {
    sweepPushes().then((moved) => {
      if (moved > 0) console.log(`Push sweep moved ${moved} post(s)`);
    });
  };
  setTimeout(run, FIRST_SWEEP_DELAY_MS);
  setInterval(run, SWEEP_INTERVAL_MS);
  console.log('Push sweep started (hourly)');
}
