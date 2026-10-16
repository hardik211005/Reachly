import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@repo/db";
import { syncDealFromLeadEvent } from "../../src/crm/deals";
import { createOffering } from "./grow-helpers";
import { afterDealWon, getPublicPage, getPublicPageSettings, getReviewInvite, listReviews, requestReview, setReviewVisibility, submitEnquiry, submitReview, updatePublicPageSettings } from "../../src/grow/service";
import { createLead, createWorkspace, resetDatabase } from "./helpers";

const pageOn = { enabled: true, headline: "Fresh cakes for cafés and offices", about: null, showPrices: true, acceptEnquiries: true, afterWinFollowUps: true };

async function businessWithPage(name = "Sweet Crumbs") {
  const workspace = await createWorkspace(name);
  await prisma.organization.update({ where: { id: workspace.organizationId }, data: { onboardingCompleted: true } });
  await createOffering(workspace.organizationId, "Custom cake", 1200);
  await updatePublicPageSettings(workspace.ctx, pageOn);
  const { slug } = await prisma.organization.findUniqueOrThrow({ where: { id: workspace.organizationId }, select: { slug: true } });
  return { ...workspace, slug };
}

describe("public business page", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is only visible when switched on, and hides prices when asked", async () => {
    const { ctx, slug } = await businessWithPage();
    const page = await getPublicPage(slug);
    expect(page?.headline).toBe("Fresh cakes for cafés and offices");
    expect(page?.offerings[0]).toMatchObject({ name: "Custom cake", unitPrice: 1200 });

    await updatePublicPageSettings(ctx, { ...pageOn, showPrices: false });
    expect((await getPublicPage(slug))?.offerings[0]?.unitPrice).toBeNull();

    await updatePublicPageSettings(ctx, { ...pageOn, enabled: false });
    expect(await getPublicPage(slug)).toBeNull();
    expect(await getPublicPage("no-such-business")).toBeNull();
  });

  it("turns an enquiry into an interested lead with a deal, a note and a notification", async () => {
    const { ctx, organizationId, slug } = await businessWithPage();
    await submitEnquiry(slug, { name: "Riya Kapoor", company: "Café Aroma", email: "riya@aroma.example", message: "Need 30 cupcakes every Friday for our café." });

    // The CRM opens the deal from the status-change event (a background job in the app).
    const statusEvent = await prisma.event.findFirstOrThrow({ where: { organizationId, type: "lead_status_changed" } });
    expect(statusEvent.properties).toMatchObject({ to: "INTERESTED" });
    await syncDealFromLeadEvent(ctx, statusEvent);
    const lead = await prisma.lead.findFirstOrThrow({ where: { organizationId }, include: { contacts: true, notes: true, deals: true } });
    expect(lead).toMatchObject({ name: "Café Aroma", sourceType: "INBOUND", status: "INTERESTED", email: "riya@aroma.example" });
    expect(lead.contacts[0]?.name).toBe("Riya Kapoor");
    expect(lead.notes[0]?.body).toContain("30 cupcakes");
    expect(lead.deals).toHaveLength(1);
    expect(await prisma.notification.count({ where: { organizationId, title: { contains: "New enquiry" } } })).toBe(1);
    // Inbound leads never use lead credits.
    expect(await prisma.usageRecord.count({ where: { organizationId, metric: "LEAD_CREDITS" } })).toBe(0);

    // The same person again adds to their lead instead of duplicating it.
    await submitEnquiry(slug, { name: "Riya Kapoor", email: "riya@aroma.example", message: "Also a birthday cake next week please." });
    expect(await prisma.lead.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.note.count({ where: { organizationId } })).toBe(2);
    expect((await getPublicPageSettings(ctx)).stats.enquiries30d).toBe(1);
  });

  it("ignores bots and refuses enquiries when the form is off", async () => {
    const { ctx, organizationId, slug } = await businessWithPage();
    await submitEnquiry(slug, { name: "Bot", email: "bot@spam.example", message: "Buy cheap followers now!!", website: "http://spam.example" });
    expect(await prisma.lead.count({ where: { organizationId } })).toBe(0);
    await expect(submitEnquiry(slug, { name: "No contact", message: "How do I reach you?" })).rejects.toThrow();
    await updatePublicPageSettings(ctx, { ...pageOn, acceptEnquiries: false });
    await expect(submitEnquiry(slug, { name: "Late", email: "late@x.example", message: "Is the form still open?" })).rejects.toThrow();
  });
});

describe("reviews from real customers", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("only invited customers can review, once, and the business can hide a review", async () => {
    const { ctx, slug } = await businessWithPage();
    const customer = await createLead(ctx, { name: "Café Aroma", phone: "+919811112222" });
    const invite = await requestReview(ctx, { leadId: customer.id });
    expect(invite.whatsappUrl).toContain("wa.me/919811112222");
    // Asking again before they answer reuses the same link.
    expect((await requestReview(ctx, { leadId: customer.id })).url).toBe(invite.url);

    const token = invite.url.split("/r/")[1]!;
    expect((await getReviewInvite(token))?.done).toBe(false);
    await submitReview(token, { rating: 5, comment: "Lovely cakes, always on time.", authorName: "Riya", authorRole: "Owner, Café Aroma" });
    await expect(submitReview(token, { rating: 1, comment: "Trying to change it", authorName: "Riya" })).rejects.toThrow(/already/);
    await expect(submitReview("made-up-token", { rating: 5, comment: "Fake review!", authorName: "Bot" })).rejects.toThrow();

    const page = await getPublicPage(slug);
    expect(page?.rating).toEqual({ average: 5, count: 1 });
    expect(page?.reviews[0]?.comment).toBe("Lovely cakes, always on time.");

    const [review] = await listReviews(ctx);
    await setReviewVisibility(ctx, review!.id, false);
    expect((await getPublicPage(slug))?.reviews).toHaveLength(0);
  });
});

describe("after a win", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("prepares a review link and two follow-up tasks, once per deal", async () => {
    const { ctx, organizationId } = await businessWithPage();
    const customer = await createLead(ctx, { name: "Office Hub" });
    const deal = await prisma.deal.create({ data: { organizationId, leadId: customer.id, title: "Weekly cookies", stage: "WON", value: 12000, wonAt: new Date() } });
    const event = await prisma.event.create({ data: { organizationId, type: "deal_won", leadId: customer.id, dealId: deal.id, value: 12000, occurredAt: new Date() } });

    await afterDealWon(ctx, event);
    await afterDealWon(ctx, event);
    const tasks = await prisma.task.findMany({ where: { organizationId, dealId: deal.id }, orderBy: { dueAt: "asc" } });
    expect(tasks.map((task) => task.title)).toEqual(["Ask Office Hub for a review", "Check in with Office Hub for repeat business"]);
    expect(tasks[0]?.description).toContain("/r/");
    expect(await prisma.review.count({ where: { organizationId, status: "REQUESTED" } })).toBe(1);
  });

  it("does nothing when the business turned follow-ups off", async () => {
    const { ctx, organizationId } = await businessWithPage();
    await updatePublicPageSettings(ctx, { ...pageOn, afterWinFollowUps: false });
    const customer = await createLead(ctx, { name: "Quiet Co" });
    const event = await prisma.event.create({ data: { organizationId, type: "deal_won", leadId: customer.id, occurredAt: new Date() } });
    await afterDealWon(ctx, event);
    expect(await prisma.task.count({ where: { organizationId } })).toBe(0);
  });
});
