import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

import { MessageList } from '../../../agent/message-list';
import type { Processor, ProcessInputStepArgs } from '../../../processors/index';
import { ToolSearchProcessor } from '../../../processors/processors/tool-search';
import { ProcessorRunner } from '../../../processors/runner';
import { RequestContext } from '../../../request-context';
import { createTool } from '../../../tools';
import type { CoreTool } from '../../../tools/types';
import { makeCoreTool } from '../../../utils';

/**
 * Tests for the fix to GitHub issue #12967:
 * ToolSearchProcessor (and other processors) returning raw Mastra tools via processInputStep
 * did not forward requestContext to those tools because they bypassed CoreToolBuilder.
 *
 * The fix converts raw ToolAction objects (from createTool) to CoreTools via makeCoreTool
 * in llm-execution-step.ts after Object.assign(currentStep, processInputStepResult).
 */
describe('processor-returned tools receive requestContext (issue #12967)', () => {
  const createMockModel = () =>
    ({
      modelId: 'test-model',
      specificationVersion: 'v2',
      provider: 'test',
      doGenerate: async () => ({}),
      doStream: async () => ({}),
    }) as any;

  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trackException: vi.fn(),
    getTransports: vi.fn(() => []),
    listLogs: vi.fn(() => []),
    listLogsByRunId: vi.fn(() => []),
  } as any;

  describe('raw ToolAction detection', () => {
    it('should identify raw Mastra tools by inputSchema without parameters', () => {
      const rawTool = createTool({
        id: 'test_tool',
        description: 'A test tool',
        inputSchema: z.object({ query: z.string() }),
        execute: async () => ({ result: 'ok' }),
      });

      // Raw Mastra tools have inputSchema but NOT parameters
      expect('inputSchema' in rawTool).toBe(true);
      expect('parameters' in rawTool).toBe(false);
    });

    it('should identify CoreTools by parameters property', () => {
      const rawTool = createTool({
        id: 'test_tool',
        description: 'A test tool',
        inputSchema: z.object({ query: z.string() }),
        execute: async () => ({ result: 'ok' }),
      });

      const requestContext = new RequestContext();
      const coreTool = makeCoreTool(rawTool, {
        name: 'test_tool',
        requestContext,
      });

      // CoreTools from makeCoreTool have parameters, NOT inputSchema
      expect('parameters' in coreTool).toBe(true);
    });
  });

  describe('makeCoreTool binds requestContext to raw tools', () => {
    it('should provide requestContext to tool execute when converted through makeCoreTool', async () => {
      let capturedContext: any = null;

      const rawTool = createTool({
        id: 'context_capture_tool',
        description: 'Captures execution context',
        inputSchema: z.object({}),
        execute: async (_input, context) => {
          capturedContext = context;
          return { captured: true };
        },
      });

      const requestContext = new RequestContext();
      requestContext.set('myCustomValue', 'Hello from requestContext!');
      requestContext.set('tenantId', 'tenant-42');

      const coreTool = makeCoreTool(rawTool, {
        name: 'context_capture_tool',
        requestContext,
        runId: 'test-run',
        threadId: 'test-thread',
        resourceId: 'test-resource',
        agentName: 'test-agent',
      });

      // Simulate how tool-call-step.ts calls tools (line 514)
      const toolOptions = {
        abortSignal: new AbortController().signal,
        toolCallId: 'call-1',
        messages: [],
      };

      await coreTool.execute!({}, toolOptions as any);

      expect(capturedContext).not.toBeNull();
      expect(capturedContext.requestContext).toBeInstanceOf(RequestContext);
      expect(capturedContext.requestContext.get('myCustomValue')).toBe('Hello from requestContext!');
      expect(capturedContext.requestContext.get('tenantId')).toBe('tenant-42');
      expect(capturedContext.runId).toBe('test-run');
    });

    it('raw tool execute called directly receives an empty requestContext (the bug)', async () => {
      let capturedContext: any = null;

      const rawTool = createTool({
        id: 'raw_tool',
        description: 'Raw tool without conversion',
        inputSchema: z.object({}),
        execute: async (_input, context) => {
          capturedContext = context;
          return { captured: true };
        },
      });

      // Simulate how tool-call-step.ts calls raw tools (the bug scenario):
      // toolOptions from tool-call-step does NOT include requestContext
      const toolOptions = {
        abortSignal: new AbortController().signal,
        toolCallId: 'call-1',
        messages: [],
      };

      await rawTool.execute!({}, toolOptions as any);

      // The Tool class creates a fallback empty RequestContext, so the tool
      // gets a requestContext but it's EMPTY — user's values are lost
      expect(capturedContext).not.toBeNull();
      expect(capturedContext.requestContext).toBeInstanceOf(RequestContext);

      // The tool never sees user-set values — that's the bug
      expect(capturedContext.requestContext.get('authToken')).toBeUndefined();
    });
  });

  describe('ToolSearchProcessor returns raw tools', () => {
    it('processInputStep returns tools with inputSchema (raw ToolAction format)', async () => {
      const myTool = createTool({
        id: 'my_tool',
        description: 'A tool that needs requestContext',
        inputSchema: z.object({ data: z.string() }),
        execute: async (_input, context) => {
          return { value: context?.requestContext?.get('key') ?? 'NOT_FOUND' };
        },
      });

      const processor = new ToolSearchProcessor({
        tools: { my_tool: myTool },
        search: { topK: 5, minScore: 0 },
        ttl: 0,
      });

      const requestContext = new RequestContext();
      requestContext.set('key', 'expected_value');

      const args: ProcessInputStepArgs = {
        messageList: new MessageList({}),
        requestContext,
        tools: {},
      };

      // Simulate loading a tool (load_tool would add it to thread state)
      processor['getLoadedToolNames']('default').add('my_tool');

      const result = await processor.processInputStep!(args as any);

      // Verify that the returned tools include the loaded tool as a raw ToolAction
      expect(result).toBeDefined();
      const tools = (result as any).tools;
      expect(tools).toBeDefined();
      expect(tools.my_tool).toBeDefined();

      // The loaded tool is raw (has inputSchema, no parameters)
      expect('inputSchema' in tools.my_tool).toBe(true);
      expect('parameters' in tools.my_tool).toBe(false);
    });

    it('loaded tools should receive requestContext after makeCoreTool conversion', async () => {
      let capturedContext: any = null;

      const myTool = createTool({
        id: 'context_aware_tool',
        description: 'Tool that uses requestContext for auth',
        inputSchema: z.object({}),
        execute: async (_input, context) => {
          capturedContext = context;
          return {
            token: context?.requestContext?.get('authToken') ?? 'MISSING',
          };
        },
      });

      const processor = new ToolSearchProcessor({
        tools: { context_aware_tool: myTool },
        search: { topK: 5, minScore: 0 },
        ttl: 0,
      });

      const requestContext = new RequestContext();
      requestContext.set('authToken', 'Bearer abc123');

      const args: ProcessInputStepArgs = {
        messageList: new MessageList({}),
        requestContext,
        tools: {},
      };

      // Load the tool
      processor['getLoadedToolNames']('default').add('context_aware_tool');

      const result = await processor.processInputStep!(args as any);
      const rawLoadedTool = (result as any).tools.context_aware_tool;

      // Convert through makeCoreTool (what the fix does in llm-execution-step.ts)
      const coreTool: CoreTool = makeCoreTool(rawLoadedTool, {
        name: 'context_aware_tool',
        requestContext,
        runId: 'test-run',
        threadId: 'thread-1',
        agentName: 'test-agent',
      });

      // Execute the converted CoreTool as tool-call-step.ts would
      const toolOptions = {
        abortSignal: new AbortController().signal,
        toolCallId: 'call-1',
        messages: [],
      };

      await coreTool.execute!({}, toolOptions as any);

      expect(capturedContext).not.toBeNull();
      expect(capturedContext.requestContext).toBeInstanceOf(RequestContext);
      expect(capturedContext.requestContext.get('authToken')).toBe('Bearer abc123');
    });
  });

  describe('custom processor returning tools', () => {
    it('processor-returned tools should be convertible and retain requestContext', async () => {
      let toolReceivedContext: any = null;

      // A custom processor that dynamically returns a tool
      const dynamicToolProcessor: Processor = {
        id: 'dynamic-tool-provider',
        processInputStep: async (args: ProcessInputStepArgs) => {
          const dynamicTool = createTool({
            id: 'dynamic_tool',
            description: 'Dynamically provided tool',
            inputSchema: z.object({ action: z.string() }),
            execute: async (_input, context) => {
              toolReceivedContext = context;
              return { status: 'executed' };
            },
          });

          return {
            tools: {
              ...(args.tools ?? {}),
              dynamic_tool: dynamicTool,
            },
          };
        },
      };

      // Run the processor
      const runner = new ProcessorRunner({
        inputProcessors: [dynamicToolProcessor],
        outputProcessors: [],
        logger: mockLogger,
        agentName: 'test-agent',
      });

      const requestContext = new RequestContext();
      requestContext.set('userId', 'user-123');
      requestContext.set('sessionToken', 'sess-xyz');

      const messageList = new MessageList({});
      messageList.add(
        [
          {
            id: 'msg-1',
            role: 'user' as const,
            content: { format: 2 as const, parts: [{ type: 'text' as const, text: 'hello' }] },
            createdAt: new Date(),
          },
        ],
        'user',
      );

      const stepResult = await runner.runProcessInputStep({
        messageList,
        stepNumber: 0,
        steps: [],
        requestContext,
        model: createMockModel(),
        tools: {},
      });

      // Verify processor returned raw tools
      expect(stepResult.tools).toBeDefined();
      const dynamicTool = stepResult.tools!['dynamic_tool'] as any;
      expect(dynamicTool).toBeDefined();
      expect('inputSchema' in dynamicTool).toBe(true);

      // Convert the raw tool (simulating what llm-execution-step.ts now does)
      const convertedTool = makeCoreTool(dynamicTool, {
        name: 'dynamic_tool',
        requestContext,
        runId: 'run-1',
        threadId: 'thread-1',
        resourceId: 'resource-1',
        agentName: 'test-agent',
        model: createMockModel(),
      });

      // Execute the converted tool as tool-call-step.ts would
      await convertedTool.execute!({ action: 'test' }, {
        abortSignal: new AbortController().signal,
        toolCallId: 'tc-1',
        messages: [],
      } as any);

      // The tool should now receive requestContext via the CoreToolBuilder wrapper
      expect(toolReceivedContext).not.toBeNull();
      expect(toolReceivedContext.requestContext).toBeInstanceOf(RequestContext);
      expect(toolReceivedContext.requestContext.get('userId')).toBe('user-123');
      expect(toolReceivedContext.requestContext.get('sessionToken')).toBe('sess-xyz');
      expect(toolReceivedContext.runId).toBe('run-1');
      expect(toolReceivedContext.agent.threadId).toBe('thread-1');
    });

    it('already-converted CoreTools should not be double-wrapped', () => {
      const rawTool = createTool({
        id: 'test_tool',
        description: 'A test tool',
        inputSchema: z.object({}),
        execute: async () => ({ ok: true }),
      });

      const requestContext = new RequestContext();
      const coreTool = makeCoreTool(rawTool, {
        name: 'test_tool',
        requestContext,
      });

      // CoreTool has parameters, no inputSchema — our detection skips it
      const hasInputSchema = 'inputSchema' in coreTool;
      const hasParameters = 'parameters' in coreTool;

      // The detection condition: inputSchema present AND parameters absent
      const wouldBeConverted = hasInputSchema && !hasParameters;
      expect(wouldBeConverted).toBe(false);
    });
  });
});
