using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Dispatching.Internal;

public class InternalSyncProcessDispatchStrategy(IMessageProcessor messageProcessor) : IInternalMessageDispatchStrategy
{
    public Task<Either<Exception, Unit>> DispatchAsync(IMessage message, IMessageContext messageContext, CancellationToken cancellationToken)
        => messageProcessor.ProcessMessageAsync(message, messageContext, cancellationToken);

    public Task<Either<Exception, TResult>> DispatchAsync<TResult>(IMessage<TResult> message, IMessageContext messageContext, CancellationToken cancellationToken)
        => messageProcessor.ProcessMessageAsync(message, messageContext, cancellationToken);
}