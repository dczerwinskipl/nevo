using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Dispatch.Internal;

public class InternalSyncProcessDispatchStrategy(IMessageProcessor messageProcessor, IMessageContextProvider messageContextFactory) : IInternalMessageDispatchStrategy
{
    public Task<Either<Exception, Unit>> DispatchAsync(IMessage message, CancellationToken cancellationToken)
        => messageProcessor.ProcessMessageAsync(message, messageContextFactory.CreateContext(), cancellationToken);

    public Task<Either<Exception, TResult>> DispatchAsync<TResult>(IMessage<TResult> message, CancellationToken cancellationToken)
        => messageProcessor.ProcessMessageAsync(message, messageContextFactory.CreateContext(), cancellationToken);
}