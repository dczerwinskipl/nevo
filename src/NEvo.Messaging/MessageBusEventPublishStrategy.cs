using LanguageExt;

namespace NEvo.Messaging;

public class MessageBusPublishStrategy(IMessageBus messageBus) : IExternalMessagePublishStrategy
{
    private IMessageBus _messageBus = messageBus;

    public Task<Either<Exception, Unit>> PublishAsync(IMessage message) 
        => _messageBus.PublishAsync(message);
}
