using NEvo.Messaging.Context;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.Publishing.Internal;

public class InternalSyncProcessPublishStrategy(
    IMessageProcessor messageProcessor
) : IInternalMessagePublishStrategy
{
    public Task<Either<Exception, Unit>> PublishAsync(IMessage message, IMessageContext messageContext, CancellationToken cancellationToken)
        => messageProcessor.ProcessMessageAsync(
            message,
            messageContext,
            cancellationToken
        );
}
