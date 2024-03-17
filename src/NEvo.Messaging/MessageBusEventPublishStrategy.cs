using LanguageExt;

namespace NEvo.Messaging;

public class MessageBusPublishStrategy(IMessageBus messageBus) : IExternalMessagePublishStrategy
{
    // TODO: choose correct message bus for message;
    //       we should also provide headers (whole MessageContext?)
    public Task<Either<Exception, Unit>> PublishAsync(IMessage message, CancellationToken cancellationToken) 
        => messageBus.PublishAsync(message, cancellationToken);
}
