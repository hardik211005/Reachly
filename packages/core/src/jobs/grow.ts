import { afterDealWon } from "../grow/service";
import { registerEventSubscriber } from "./events";

// A won deal schedules a review request and a repeat-business check-in.
registerEventSubscriber("grow", async (ctx, event) => {
  await afterDealWon(ctx, event);
});
