import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { google } from "googleapis";

let gmailConnectionSettings: any;

async function getGmailAccessToken() {
  if (gmailConnectionSettings && gmailConnectionSettings.settings.expires_at && new Date(gmailConnectionSettings.settings.expires_at).getTime() > Date.now()) {
    return gmailConnectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  gmailConnectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-mail',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = gmailConnectionSettings?.settings?.access_token || gmailConnectionSettings.settings?.oauth?.credentials?.access_token;

  if (!gmailConnectionSettings || !accessToken) {
    throw new Error('Gmail not connected');
  }
  return accessToken;
}

async function getGmailClient() {
  const accessToken = await getGmailAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

export const listEmailsTool = createTool({
  id: "list-emails",
  description:
    "Lists recent emails from the inbox. Use this to find campaign-related event invitations and opportunities.",
  inputSchema: z.object({
    maxResults: z
      .number()
      .optional()
      .default(50)
      .describe("Maximum number of emails to retrieve (default 50)"),
    query: z
      .string()
      .optional()
      .describe(
        "Optional Gmail search query to filter emails (e.g., 'is:unread' or 'subject:invitation')",
      ),
  }),
  outputSchema: z.object({
    emails: z.array(
      z.object({
        id: z.string(),
        threadId: z.string(),
        subject: z.string(),
        from: z.string(),
        date: z.string(),
        snippet: z.string(),
        labels: z.array(z.string()),
      }),
    ),
    totalCount: z.number(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📧 [listEmailsTool] Starting email retrieval", {
      maxResults: context.maxResults,
      query: context.query,
    });

    try {
      const gmail = await getGmailClient();

      const listResponse = await gmail.users.messages.list({
        userId: "me",
        maxResults: context.maxResults || 50,
        q: context.query || "",
      });

      const messages = listResponse.data.messages || [];
      logger?.info(`📧 [listEmailsTool] Found ${messages.length} emails`);

      const emails = [];
      for (const message of messages) {
        try {
          const emailData = await gmail.users.messages.get({
            userId: "me",
            id: message.id!,
            format: "metadata",
            metadataHeaders: ["Subject", "From", "Date"],
          });

          const headers = emailData.data.payload?.headers || [];
          const subject =
            headers.find((h) => h.name === "Subject")?.value || "(No Subject)";
          const from =
            headers.find((h) => h.name === "From")?.value || "Unknown";
          const date = headers.find((h) => h.name === "Date")?.value || "";

          emails.push({
            id: message.id!,
            threadId: message.threadId!,
            subject,
            from,
            date,
            snippet: emailData.data.snippet || "",
            labels: emailData.data.labelIds || [],
          });
        } catch (err) {
          logger?.warn(`⚠️ [listEmailsTool] Failed to fetch email ${message.id}`, { error: err });
        }
      }

      logger?.info(
        `✅ [listEmailsTool] Successfully retrieved ${emails.length} emails`,
      );
      return { emails, totalCount: emails.length };
    } catch (error) {
      logger?.error("❌ [listEmailsTool] Failed to list emails", { error });
      throw error;
    }
  },
});

export const getEmailContentTool = createTool({
  id: "get-email-content",
  description:
    "Gets the full content/body of a specific email by its ID. Use this to read the details of event invitations.",
  inputSchema: z.object({
    emailId: z.string().describe("The ID of the email to retrieve"),
  }),
  outputSchema: z.object({
    id: z.string(),
    threadId: z.string(),
    subject: z.string(),
    from: z.string(),
    to: z.string(),
    date: z.string(),
    body: z.string(),
    labels: z.array(z.string()),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📧 [getEmailContentTool] Fetching email content", {
      emailId: context.emailId,
    });

    try {
      const gmail = await getGmailClient();

      const emailData = await gmail.users.messages.get({
        userId: "me",
        id: context.emailId,
        format: "full",
      });

      const headers = emailData.data.payload?.headers || [];
      const subject =
        headers.find((h) => h.name === "Subject")?.value || "(No Subject)";
      const from = headers.find((h) => h.name === "From")?.value || "Unknown";
      const to = headers.find((h) => h.name === "To")?.value || "";
      const date = headers.find((h) => h.name === "Date")?.value || "";

      let body = "";
      const payload = emailData.data.payload;

      if (payload?.body?.data) {
        body = Buffer.from(payload.body.data, "base64").toString("utf-8");
      } else if (payload?.parts) {
        for (const part of payload.parts) {
          if (part.mimeType === "text/plain" && part.body?.data) {
            body = Buffer.from(part.body.data, "base64").toString("utf-8");
            break;
          } else if (part.mimeType === "text/html" && part.body?.data) {
            body = Buffer.from(part.body.data, "base64").toString("utf-8");
          }
        }
      }

      logger?.info("✅ [getEmailContentTool] Successfully retrieved email content");
      return {
        id: context.emailId,
        threadId: emailData.data.threadId!,
        subject,
        from,
        to,
        date,
        body,
        labels: emailData.data.labelIds || [],
      };
    } catch (error) {
      logger?.error("❌ [getEmailContentTool] Failed to get email content", {
        error,
      });
      throw error;
    }
  },
});

export const createOrGetLabelTool = createTool({
  id: "create-or-get-label",
  description:
    "Creates a Gmail label if it doesn't exist, or gets it if it does. Use this to create the 'AZCorpComm_Event' tag.",
  inputSchema: z.object({
    labelName: z.string().describe("The name of the label to create or get"),
  }),
  outputSchema: z.object({
    labelId: z.string(),
    labelName: z.string(),
    created: z.boolean(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🏷️ [createOrGetLabelTool] Creating/getting label", {
      labelName: context.labelName,
    });

    try {
      const gmail = await getGmailClient();

      const labelsResponse = await gmail.users.labels.list({ userId: "me" });
      const existingLabel = labelsResponse.data.labels?.find(
        (l) => l.name === context.labelName,
      );

      if (existingLabel) {
        logger?.info("✅ [createOrGetLabelTool] Label already exists", {
          labelId: existingLabel.id,
        });
        return {
          labelId: existingLabel.id!,
          labelName: context.labelName,
          created: false,
        };
      }

      const createResponse = await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name: context.labelName,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
      });

      logger?.info("✅ [createOrGetLabelTool] Label created", {
        labelId: createResponse.data.id,
      });
      return {
        labelId: createResponse.data.id!,
        labelName: context.labelName,
        created: true,
      };
    } catch (error) {
      logger?.error("❌ [createOrGetLabelTool] Failed to create/get label", {
        error,
      });
      throw error;
    }
  },
});

export const addLabelToEmailTool = createTool({
  id: "add-label-to-email",
  description:
    "Adds a label/tag to an email. Use this to tag campaign event emails with 'AZCorpComm_Event'.",
  inputSchema: z.object({
    emailId: z.string().describe("The ID of the email to label"),
    labelId: z.string().describe("The ID of the label to add"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    emailId: z.string(),
    labelId: z.string(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🏷️ [addLabelToEmailTool] Adding label to email", {
      emailId: context.emailId,
      labelId: context.labelId,
    });

    try {
      const gmail = await getGmailClient();

      await gmail.users.messages.modify({
        userId: "me",
        id: context.emailId,
        requestBody: {
          addLabelIds: [context.labelId],
        },
      });

      logger?.info("✅ [addLabelToEmailTool] Label added successfully");
      return {
        success: true,
        emailId: context.emailId,
        labelId: context.labelId,
      };
    } catch (error) {
      logger?.error("❌ [addLabelToEmailTool] Failed to add label", { error });
      throw error;
    }
  },
});

export const createDraftReplyTool = createTool({
  id: "create-draft-reply",
  description:
    "Creates a draft reply to an email. Use this to draft confirmation requests for upcoming events or apology emails for missed events.",
  inputSchema: z.object({
    threadId: z.string().describe("The thread ID of the original email"),
    to: z.string().describe("The recipient email address"),
    subject: z.string().describe("The subject of the reply"),
    body: z
      .string()
      .describe("The body content of the draft reply (plain text)"),
    inReplyTo: z
      .string()
      .optional()
      .describe("The Message-ID header of the email being replied to"),
  }),
  outputSchema: z.object({
    draftId: z.string(),
    threadId: z.string(),
    success: z.boolean(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📝 [createDraftReplyTool] Creating draft reply", {
      threadId: context.threadId,
      to: context.to,
      subject: context.subject,
    });

    try {
      const gmail = await getGmailClient();

      const rawMessage = [
        `To: ${context.to}`,
        `Subject: ${context.subject}`,
        `Content-Type: text/plain; charset=utf-8`,
        context.inReplyTo ? `In-Reply-To: ${context.inReplyTo}` : "",
        "",
        context.body,
      ]
        .filter(Boolean)
        .join("\r\n");

      const encodedMessage = Buffer.from(rawMessage)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const draft = await gmail.users.drafts.create({
        userId: "me",
        requestBody: {
          message: {
            raw: encodedMessage,
            threadId: context.threadId,
          },
        },
      });

      logger?.info("✅ [createDraftReplyTool] Draft created successfully", {
        draftId: draft.data.id,
      });
      return {
        draftId: draft.data.id!,
        threadId: context.threadId,
        success: true,
      };
    } catch (error) {
      logger?.error("❌ [createDraftReplyTool] Failed to create draft", {
        error,
      });
      throw error;
    }
  },
});
