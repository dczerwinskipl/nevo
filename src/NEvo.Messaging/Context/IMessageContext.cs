﻿namespace NEvo.Messaging.Context;

public interface IMessageContext
{
    IMessageContextHeaders Headers { get; }
    Option<string> CorrelationId => Headers.CorrelationId;
    Option<string> CausationId => Headers.CausationId;
    IServiceProvider ServiceProvider { get; }

    bool SingleThread { get; }
    void ForceSingleThread();
}
