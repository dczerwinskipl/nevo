using NEvo.Messaging.Bus;
using NEvo.Messaging.Context;

namespace NEvo.Messaging.Publishing.External;
public class MessageBusPublishStrategy(
    IMessageBus messageBus
) : IExternalMessagePublishStrategy
{
    // TODO: choose correct message bus for message;
    public Task<Either<Exception, Unit>> PublishAsync(IMessage message, IMessageContext messageContext, CancellationToken cancellationToken)
        => messageBus.PublishAsync(
            message,
            messageContext,
            cancellationToken
        );
}
