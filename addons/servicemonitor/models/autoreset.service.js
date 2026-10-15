// Service Monitor: the automatic "Reset statistics" of Settings. Checked once a minute by the background
// scheduler (models/checker.service.js); when the next reset is due it clears the chosen data of every
// monitor, as Service Health's Reset statistics with "All monitors" and "Everything" would, and records it.
const settings = require('./settings.model');
const services = require('./services.model');

const EVERY_MS = 60 * 1000;
let lastLook = 0, running = false;

exports.tick = async function () {
  if (running || Date.now() - lastLook < EVERY_MS) return;
  lastLook = Date.now();
  const a = (await settings.get()).autoReset;
  const due = settings.nextReset(a);
  if (!due || due.getTime() > Date.now()) return;
  running = true;
  try {
    const result = await services.reset({ ids: null, before: null, checks: a.checks, events: a.events });
    await settings.recordAutoReset(result);
    console.log(`Service Monitor: automatic statistics reset (every ${a.everyDays} d at ${a.at}): ${result.checks} checks, ${result.events} incidents deleted.`);
  } finally {
    running = false;
  }
};
