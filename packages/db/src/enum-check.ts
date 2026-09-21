/**
 * Compile-time guard: the domain vocabularies in @repo/config must match the Prisma enums.
 * If this file fails to type-check, update packages/config/src/domain.ts or the schema.
 */
import type {
  AutomationMode as ConfigAutomationMode,
  BusinessSize as ConfigBusinessSize,
  CallOutcome as ConfigCallOutcome,
  Channel as ConfigChannel,
  DealStage as ConfigDealStage,
  LeadStatus as ConfigLeadStatus,
  MemberRole as ConfigMemberRole,
  ReplyIntent as ConfigReplyIntent,
  UsageMetric as ConfigUsageMetric,
} from "@repo/config";
import type {
  AutomationMode,
  BusinessSize,
  CallOutcome,
  Channel,
  DealStage,
  LeadStatus,
  MemberRole,
  ReplyIntent,
  UsageMetric,
} from "./generated/prisma/enums";

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const enumParity: {
  leadStatus: Equals<LeadStatus, ConfigLeadStatus>;
  dealStage: Equals<DealStage, ConfigDealStage>;
  channel: Equals<Channel, ConfigChannel>;
  automationMode: Equals<AutomationMode, ConfigAutomationMode>;
  callOutcome: Equals<CallOutcome, ConfigCallOutcome>;
  replyIntent: Equals<ReplyIntent, ConfigReplyIntent>;
  memberRole: Equals<MemberRole, ConfigMemberRole>;
  businessSize: Equals<BusinessSize, ConfigBusinessSize>;
  usageMetric: Equals<UsageMetric, ConfigUsageMetric>;
} = {
  leadStatus: true,
  dealStage: true,
  channel: true,
  automationMode: true,
  callOutcome: true,
  replyIntent: true,
  memberRole: true,
  businessSize: true,
  usageMetric: true,
};
