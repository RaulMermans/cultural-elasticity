/**
 * Sprint 10C: journaled wrappers for the three paid providers an investigation uses (Qloo, the agent model, the query
 * interpreter). Outside a durable scope they pass every call through unchanged.
 *
 * The answer the runtime sees is the answer that was committed: a replay receives the stored answer (including a
 * stored failure) and the provider is not called again.
 */
import type { AgentModelInfo } from "@cultural-elasticity/shared";
import type { ModelTurn } from "../contracts.js";
import type { AgentDecisionContext, AgentModel, FinalizationContext, SynthesisTurn } from "../model/provider.js";
import type { InterpretInput, InterpretOutcome, InterpreterInfo, QueryInterpreter } from "../query/interpreter.js";
import type { AgentToolProvider, QlooCallResult } from "../tool-provider.js";
import type { QlooOperation, QlooOperationInput } from "../../qloo/types.js";
import { journaled, type JournalCodec } from "./scope.js";

function thrown(stored: unknown): Error | null {
  const message = (stored as { thrown?: unknown } | null)?.thrown;
  return typeof message === "string" ? new Error(message) : null;
}

const qlooCodec: JournalCodec<QlooCallResult> = {
  encode(result) {
    const correlationId = "call" in result ? result.call.envelope.execution.correlation_id : result.outcome === "failed" ? (result.correlationId ?? null) : null;
    return { status: result.outcome === "failed" ? "FAILED" : "COMPLETED", result, correlationId, errorCode: result.outcome === "failed" ? result.code : null };
  },
  decode(stored, _status, opKey) {
    const error = thrown(stored);
    if (error) return error;
    const result = stored as QlooCallResult;
    // A reused answer waited for nothing: no spacing, rate-limit or startup time is replayed.
    return { ...result, callMeta: { operationId: opKey, spacingMs: 0, rateLimitMs: 0, startupMs: 0 } };
  },
};

export class JournaledToolProvider implements AgentToolProvider {
  readonly name: string;
  readonly mode: "live" | "scripted";
  readonly evidenceSource: string;
  constructor(private readonly inner: AgentToolProvider) {
    this.name = inner.name;
    this.mode = inner.mode;
    this.evidenceSource = inner.evidenceSource;
  }

  call<O extends QlooOperation>(operation: O, input: QlooOperationInput[O], options: { maxRetries?: number; onDispatch?: () => Promise<void> } = {}): Promise<QlooCallResult> {
    return journaled("qloo", operation, input, qlooCodec, async (dispatching, opKey) => {
      const result = await this.inner.call(operation, input, { ...options, onDispatch: async () => {
        await dispatching();
        await options.onDispatch?.();
      } });
      return opKey ? { ...result, callMeta: { ...result.callMeta, operationId: opKey } } : result;
    });
  }

  close(): void {
    this.inner.close?.();
  }
}

function turnCodec<T extends { usage?: unknown }>(): JournalCodec<T> {
  return {
    encode: (turn) => ({ status: "COMPLETED", result: turn, usage: turn.usage ?? null }),
    decode: (stored) => thrown(stored) ?? (stored as T),
  };
}

export class JournaledModel implements AgentModel {
  readonly info: AgentModelInfo;
  readonly synthesize?: (context: FinalizationContext, feedback: string[]) => Promise<SynthesisTurn>;
  constructor(private readonly inner: AgentModel) {
    this.info = inner.info;
    if (inner.synthesize) {
      const synthesize = inner.synthesize.bind(inner);
      this.synthesize = (context, feedback) =>
        journaled("model", "synthesize", { context, feedback }, turnCodec<SynthesisTurn>(), async (dispatching) => {
          await dispatching();
          return synthesize(context, feedback);
        }, async () => {
          await inner.replaySynthesis?.(context, feedback);
        });
    }
  }

  decide(context: AgentDecisionContext): Promise<ModelTurn> {
    return journaled("model", "decide", context, turnCodec<ModelTurn>(), async (dispatching) => {
      await dispatching();
      return this.inner.decide(context);
    }, async () => {
      await this.inner.replay?.(context);
    });
  }
}

export class JournaledInterpreter implements QueryInterpreter {
  readonly info: InterpreterInfo;
  constructor(private readonly inner: QueryInterpreter) {
    this.info = inner.info;
  }

  interpret(input: InterpretInput): Promise<InterpretOutcome> {
    return journaled("interpreter", "interpret", input, turnCodec<InterpretOutcome>(), async (dispatching) => {
      await dispatching();
      return this.inner.interpret(input);
    });
  }
}
