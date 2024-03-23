using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Publishing.Internal;

public class InternalSyncProcessPublishStrategy(IMessageProcessor messageProcessor, IMessageContextFactory messageContextFactory) : IInternalMessagePublishStrategy
{
    public Task<Either<Exception, Unit>> PublishAsync(IMessage message, CancellationToken cancellationToken)
        => messageProcessor.ProcessMessageAsync(message, messageContextFactory.CreateContext(), cancellationToken);
}
