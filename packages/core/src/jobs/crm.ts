import { syncDealFromLeadEvent } from "../crm/deals";
import { expireQuotes } from "../quotes/service";
import { registerEventSubscriber } from "./events";
import { registerProcessor } from "./registry";

registerProcessor("quotes.expire", async () => expireQuotes());

registerEventSubscriber("crm", async (ctx, event) => {
  await syncDealFromLeadEvent(ctx, event);
});
