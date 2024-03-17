namespace NEvo.Messaging.Handling.Middleware;

public class InboxMessageProcessingMiddleware : IMessageProcessingMiddleware, IMessageProcessingHandlerMiddleware
{
    private readonly IMessageInbox _messageInbox;

    public InboxMessageProcessingMiddleware(IMessageInbox messageInbox)
    {
        _messageInbox = Check.Null(messageInbox);
    }

    public async Task<Either<Exception, object>> ExecuteAsync(IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        if (_messageInbox.IsAlreadyProcessed(message, context))
            return Unit.Default;

        var result = await next();

        result.IfRight(_ => _messageInbox.RegisterProcessed(message, context));

        return result;
    }

    public async Task<Either<Exception, object>> ExecuteAsync(IMessageHandler handler, IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        if (_messageInbox.IsAlreadyProcessed(handler, message, context))
            return Unit.Default;

        var result = await next();

        result.IfRight(_ => _messageInbox.RegisterProcessed(handler, message, context));

        return result;
    }
}
