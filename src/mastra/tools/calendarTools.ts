import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { google } from "googleapis";

let calendarConnectionSettings: any;

async function getCalendarAccessToken() {
  if (calendarConnectionSettings && calendarConnectionSettings.settings.expires_at && new Date(calendarConnectionSettings.settings.expires_at).getTime() > Date.now()) {
    return calendarConnectionSettings.settings.access_token;
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

  calendarConnectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-calendar',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = calendarConnectionSettings?.settings?.access_token || calendarConnectionSettings.settings?.oauth?.credentials?.access_token;

  if (!calendarConnectionSettings || !accessToken) {
    throw new Error('Google Calendar not connected');
  }
  return accessToken;
}

async function getCalendarClient() {
  const accessToken = await getCalendarAccessToken();
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

export const createCalendarEventTool = createTool({
  id: "create-calendar-event",
  description:
    "Creates a new calendar event in Google Calendar. Use this to add campaign events extracted from emails.",
  inputSchema: z.object({
    summary: z.string().describe("The title/name of the event"),
    description: z
      .string()
      .optional()
      .describe("The description of the event, can include link to original email"),
    location: z.string().optional().describe("The location of the event"),
    startDateTime: z
      .string()
      .describe("Start date/time in ISO 8601 format (e.g., 2025-01-15T10:00:00)"),
    endDateTime: z
      .string()
      .describe("End date/time in ISO 8601 format (e.g., 2025-01-15T12:00:00)"),
    timeZone: z
      .string()
      .optional()
      .default("America/Phoenix")
      .describe("Time zone for the event (default: America/Phoenix)"),
    allDay: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether this is an all-day event"),
  }),
  outputSchema: z.object({
    eventId: z.string(),
    htmlLink: z.string(),
    summary: z.string(),
    success: z.boolean(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📅 [createCalendarEventTool] Creating calendar event", {
      summary: context.summary,
      startDateTime: context.startDateTime,
      location: context.location,
    });

    try {
      const calendar = await getCalendarClient();

      let start: { dateTime?: string; date?: string; timeZone?: string };
      let end: { dateTime?: string; date?: string; timeZone?: string };

      if (context.allDay) {
        const startDate = context.startDateTime.split("T")[0];
        const endDate = context.endDateTime.split("T")[0];
        start = { date: startDate };
        end = { date: endDate };
      } else {
        start = {
          dateTime: context.startDateTime,
          timeZone: context.timeZone || "America/Phoenix",
        };
        end = {
          dateTime: context.endDateTime,
          timeZone: context.timeZone || "America/Phoenix",
        };
      }

      const event = await calendar.events.insert({
        calendarId: "primary",
        requestBody: {
          summary: context.summary,
          description: context.description,
          location: context.location,
          start,
          end,
        },
      });

      logger?.info("✅ [createCalendarEventTool] Calendar event created", {
        eventId: event.data.id,
        htmlLink: event.data.htmlLink,
      });

      return {
        eventId: event.data.id!,
        htmlLink: event.data.htmlLink!,
        summary: context.summary,
        success: true,
      };
    } catch (error) {
      logger?.error("❌ [createCalendarEventTool] Failed to create event", {
        error,
      });
      throw error;
    }
  },
});

export const listUpcomingEventsTool = createTool({
  id: "list-upcoming-events",
  description:
    "Lists upcoming calendar events to check for existing events and avoid duplicates.",
  inputSchema: z.object({
    maxResults: z
      .number()
      .optional()
      .default(50)
      .describe("Maximum number of events to retrieve"),
    timeMin: z
      .string()
      .optional()
      .describe("Minimum time to search from (ISO 8601 format)"),
  }),
  outputSchema: z.object({
    events: z.array(
      z.object({
        id: z.string(),
        summary: z.string(),
        start: z.string(),
        end: z.string(),
        location: z.string().optional(),
      }),
    ),
    totalCount: z.number(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📅 [listUpcomingEventsTool] Listing upcoming events", {
      maxResults: context.maxResults,
    });

    try {
      const calendar = await getCalendarClient();

      const response = await calendar.events.list({
        calendarId: "primary",
        maxResults: context.maxResults || 50,
        timeMin: context.timeMin || new Date().toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = (response.data.items || []).map((event) => ({
        id: event.id!,
        summary: event.summary || "(No Title)",
        start: event.start?.dateTime || event.start?.date || "",
        end: event.end?.dateTime || event.end?.date || "",
        location: event.location || undefined,
      }));

      logger?.info(
        `✅ [listUpcomingEventsTool] Found ${events.length} upcoming events`,
      );

      return {
        events,
        totalCount: events.length,
      };
    } catch (error) {
      logger?.error("❌ [listUpcomingEventsTool] Failed to list events", {
        error,
      });
      throw error;
    }
  },
});
