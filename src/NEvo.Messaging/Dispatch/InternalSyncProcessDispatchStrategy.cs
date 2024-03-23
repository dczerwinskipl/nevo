using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Dispatch;

public class InternalSyncProcessDispatchStrategy(IMessageProcessor messageProcessor, IMessageContextFactory messageContextFactory) : IInternalMessageDispatchStrategy
{
    private IMessageProcessor _messageProcessor = messageProcessor;

    public Task<Either<Exception, Unit>> DispatchAsync(IMessage message, CancellationToken cancellationToken)
        => _messageProcessor.ProcessMessageAsync(message, messageContextFactory.Create(), cancellationToken);

    public Task<Either<Exception, TResult>> DispatchAsync<TResult>(IMessage<TResult> message, CancellationToken cancellationToken)
        => _messageProcessor.ProcessMessageAsync(message, messageContextFactory.Create(), cancellationToken);
}