# Overview

This is a Mastra-based AI automation platform built for Replit that enables users to create time-based and webhook-triggered workflows. The application uses Mastra agents, tools, and workflows to orchestrate complex AI-powered automations with durable execution via Inngest.

The primary use case is campaign email management - specifically processing emails related to political campaign events, extracting event information, managing calendar entries, and drafting appropriate responses.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Core Framework

**Mastra Framework**: The application is built on Mastra v0.20.0, an all-in-one TypeScript framework for AI-powered applications. Mastra provides agents (for LLM-based reasoning), tools (for executing specific functions), and workflows (for orchestrating multi-step processes).

**Design Pattern**: The system follows a clear separation between triggers (time-based cron or webhooks), workflows (step-by-step orchestration), and agents (AI reasoning with tools). This modular approach allows workflows to be triggered by different sources while maintaining the same execution logic.

## Agent Architecture

**Campaign Email Agent**: The primary agent (`campaignEmailAgent`) processes campaign-related emails with memory and tool capabilities. Agents use OpenAI or Anthropic models for reasoning and can be equipped with custom tools for specific tasks.

**Memory System**: Agents support conversation history, semantic recall (RAG-based), and working memory for maintaining context across interactions. Memory is scoped per thread (conversation) or resource (user/organization).

**Agent Generation**: The system uses the legacy `.generateLegacy()` method for backward compatibility with the Replit Playground UI, rather than the newer `.generate()` SDK v5 methods.

## Workflow Orchestration

**Inngest Integration**: Critical for production durability - workflows are executed through Inngest which provides step-by-step memoization, retry logic, and the ability to resume from failures. The custom integration lives in `src/mastra/inngest/` and is configured in the main `src/mastra/index.ts`.

**Campaign Email Workflow**: The main workflow (`campaignEmailWorkflow`) handles the campaign email processing automation, triggered on a cron schedule (default: daily at 8 AM, configurable via `SCHEDULE_CRON_EXPRESSION`).

**Suspend/Resume Capability**: Workflows support human-in-the-loop patterns where execution can pause for user input, approval, or external resources, with state persisted as snapshots in storage.

**Control Flow**: Workflows support sequential execution (`.then()`), parallel execution (`.parallel()`), conditional branching (`.when()`), and loops (`.dountil()`). Steps can transform data using `.map()` for schema compatibility.

## Storage Layer

**Shared Storage**: The system uses a shared storage provider pattern configured at the Mastra instance level. Agents with memory enabled automatically use this shared storage for conversation threads, messages, and working memory.

**Supported Backends**: The codebase includes support for multiple storage adapters:
- LibSQL (local file or remote Turso)
- PostgreSQL with pgvector extension
- Upstash (Redis + Vector)

**Vector Database**: Semantic recall in memory requires vector storage for embedding-based similarity search. Each storage adapter provides its own vector implementation.

## Trigger System

**Time-Based Triggers**: Cron-based automation using standard 5-field cron expressions. Registered via `registerCronTrigger()` in `src/mastra/index.ts` before Mastra initialization. These don't create HTTP endpoints but rather schedule workflow execution through Inngest.

**Webhook Triggers**: HTTP endpoints that receive external events and start workflows. Examples include:
- Slack message events (`src/triggers/slackTriggers.ts`)
- Telegram bot messages (`src/triggers/telegramTriggers.ts`)
- Generic connector webhooks (`src/triggers/exampleConnectorTrigger.ts`)

**Trigger Pattern**: Webhooks use `registerApiRoute()` to create HTTP handlers that validate payloads, extract relevant data, and call `workflow.start()` with appropriate input. The routing happens through Inngest events for durability.

## Development Environment

**Mastra Playground UI**: A built-in UI for testing agents and workflows, running on the Mastra dev server. It provides a chat interface for agents and a visual graph view for workflows. The playground requires `.generateLegacy()` for agent calls and uses plain English node descriptions for clarity.

**Local Development**:
- Mastra server: `npm run dev` (port 5000)
- Inngest dev server: `inngest dev -u http://localhost:5000/api/inngest --port 3000`
- Testing scripts in `tests/` for cron and webhook automation

**TypeScript Configuration**: ES2022 modules with bundler resolution, strict mode enabled. The project uses ES modules (`"type": "module"` in package.json).

# External Dependencies

## AI Model Providers

- **OpenAI**: Primary LLM provider via `@ai-sdk/openai` (GPT-4o, GPT-4o-mini)
- **Anthropic**: Secondary provider via `@ai-sdk/anthropic` and `@anthropic-ai/sdk`
- **OpenRouter**: Alternative provider via `@openrouter/ai-sdk-provider`
- **Vercel AI SDK**: Core streaming and generation capabilities via `ai` package v4.3.16

## Orchestration & Infrastructure

- **Inngest**: Durable workflow execution engine (`inngest` v3.40.2, `@inngest/realtime` v0.3.1)
  - Provides step memoization, retries, suspend/resume
  - Real-time monitoring dashboard
  - Event-driven architecture for workflow triggers
- **Mastra Inngest Integration**: Custom adapter (`@mastra/inngest` v0.16.0) bridges Mastra workflows to Inngest functions

## Storage & Memory

- **LibSQL**: SQLite-compatible database via `@mastra/libsql` v0.15.1 (local or Turso cloud)
- **PostgreSQL**: Via `@mastra/pg` v0.17.1 with pgvector for semantic search
- **Memory System**: `@mastra/memory` v0.15.5 handles conversation history, semantic recall, and working memory

## Third-Party Integrations

- **Slack**: `@slack/web-api` v7.9.3 for bot interactions and messaging
- **Google APIs**: `googleapis` v148.0.0 for calendar, Gmail, or other Google services
- **Exa**: `exa-js` v1.8.17 for web search capabilities

## Logging & Observability

- **Pino**: Structured logging via `pino` v9.9.4
- **Mastra Loggers**: `@mastra/loggers` v0.10.15 for production logging
- **Custom Logger**: Production-ready PinoLogger implementation in `src/mastra/index.ts`

## Development Tools

- **TypeScript**: v5.9.3 with strict mode
- **TSX**: v4.20.3 for TypeScript execution
- **Mastra CLI**: v0.14.0 for scaffolding and development
- **Prettier**: v3.6.2 for code formatting
- **Environment Variables**: `dotenv` v17.2.0 for configuration

## Schema Validation

- **Zod**: v3.25.76 for runtime type validation of inputs, outputs, and schemas throughout agents, tools, and workflows