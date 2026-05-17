export interface AgentRuntimeClient {
  isConnected(): boolean;
  chatWithOptions(options: {
    message: string;
    sessionId?: string;
    modelOverride?: string;
  }): AsyncGenerator<unknown>;
}

export function adaptCoreClient(client: {
  isConnected(): boolean;
  chat(message: string, sessionId?: string): AsyncGenerator<unknown>;
}): AgentRuntimeClient {
  const candidate = client as {
    isConnected(): boolean;
    chat(message: string, sessionId?: string): AsyncGenerator<unknown>;
    chatWithOptions?: (options: {
      message: string;
      sessionId?: string;
      modelOverride?: string;
    }) => AsyncGenerator<unknown>;
  };

  return {
    isConnected: () => candidate.isConnected(),
    chatWithOptions: (options) => {
      if (typeof candidate.chatWithOptions === "function") {
        return candidate.chatWithOptions(options);
      }
      return candidate.chat(options.message, options.sessionId);
    },
  };
}
