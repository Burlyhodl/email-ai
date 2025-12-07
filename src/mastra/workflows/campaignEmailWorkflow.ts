import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { campaignEmailAgent } from "../agents/campaignEmailAgent";

const processEmailsStep = createStep({
  id: "process-campaign-emails",
  description:
    "Processes inbox emails to identify, tag, and respond to campaign event invitations using the Campaign Email Agent",

  inputSchema: z.object({}),

  outputSchema: z.object({
    agentResponse: z.string(),
    processedAt: z.string(),
    success: z.boolean(),
  }),

  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🚀 [Step 1] Starting campaign email processing...");

    const today = new Date();
    const todayFormatted = today.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const prompt = `
Today's date is: ${todayFormatted}

Please process my inbox to find and manage campaign-related emails for my Arizona Corporation Commission campaign. Specifically:

1. First, create or get the "AZCorpComm_Event" label that will be used to tag campaign event emails.

2. List recent emails from my inbox (up to 50 emails).

3. For each email, analyze if it matches campaign event criteria:
   - Event invitations (debates, forums, town halls, candidate trainings)
   - Political networking events
   - Speaking engagement opportunities
   - Endorsement interviews
   - Tabling or campaign promotion opportunities

4. For matching emails:
   a. Tag them with the "AZCorpComm_Event" label
   b. Get the full email content to extract event details
   c. Create a calendar event with the extracted information (event name, date, time, location)
   d. Create an appropriate draft reply:
      - For upcoming events: draft a confirmation request
      - For past events: draft an apology with inquiry about future opportunities

5. Provide a summary of what was processed.

Please proceed with processing my campaign emails now.
`;

    try {
      logger?.info("📧 [Step 1] Calling Campaign Email Agent...");

      const response = await campaignEmailAgent.generate(prompt, {
        maxSteps: 20,
      });

      logger?.info("✅ [Step 1] Campaign Email Agent completed processing");

      return {
        agentResponse: response.text,
        processedAt: new Date().toISOString(),
        success: true,
      };
    } catch (error) {
      logger?.error("❌ [Step 1] Failed to process emails", {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        agentResponse: `Error processing emails: ${error instanceof Error ? error.message : String(error)}`,
        processedAt: new Date().toISOString(),
        success: false,
      };
    }
  },
});

const generateSummaryStep = createStep({
  id: "generate-summary",
  description: "Generates a final summary report of the email processing results",

  inputSchema: z.object({
    agentResponse: z.string(),
    processedAt: z.string(),
    success: z.boolean(),
  }),

  outputSchema: z.object({
    summary: z.string(),
    completedAt: z.string(),
    overallSuccess: z.boolean(),
  }),

  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📊 [Step 2] Generating summary report...");

    const summary = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 CAMPAIGN EMAIL PROCESSING REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏰ Processed at: ${inputData.processedAt}
✅ Status: ${inputData.success ? "Successful" : "Failed"}

📝 Agent Report:
${inputData.agentResponse}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 Next Steps:
- Review the draft replies in Gmail before sending
- Check your calendar for new events
- Look for emails tagged with "AZCorpComm_Event"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    logger?.info(summary);
    logger?.info("✅ [Step 2] Summary report generated");

    return {
      summary,
      completedAt: new Date().toISOString(),
      overallSuccess: inputData.success,
    };
  },
});

export const campaignEmailWorkflow = createWorkflow({
  id: "campaign-email-workflow",

  inputSchema: z.object({}) as any,

  outputSchema: z.object({
    summary: z.string(),
    completedAt: z.string(),
    overallSuccess: z.boolean(),
  }),
})
  .then(processEmailsStep as any)
  .then(generateSummaryStep as any)
  .commit();
