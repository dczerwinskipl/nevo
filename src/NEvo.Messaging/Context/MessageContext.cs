﻿namespace NEvo.Messaging.Context;

public class MessageContext(IDictionary<string, string> headers, IServiceProvider serviceProvider) : IMessageContext
{
    public IMessageContextHeaders Headers { get; } = new MessageContextHeaders(Check.Null(headers));

    // TODO: remove?
    public IServiceProvider ServiceProvider { get; } = Check.Null(serviceProvider);
    public IScopedMessageContext CreateScope() => new ScopedMessageContext(Headers.ToDictionary(), ServiceProvider);
}