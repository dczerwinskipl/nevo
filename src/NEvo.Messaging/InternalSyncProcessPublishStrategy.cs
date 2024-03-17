using NEvo.Messaging.Handling;

namespace NEvo.Messaging;

public class InternalSyncProcessPublishStrategy(IMessageProcessor messageProcessor, IMessageContextFactory messageContextFactory) : IInternalMessagePublishStrategy
{
    private IMessageProcessor _messageProcessor = messageProcessor;

    public Task<Either<Exception, Unit>> PublishAsync(IMessage message, CancellationToken cancellationToken) 
        => _messageProcessor.ProcessMessageAsync(message, messageContextFactory.Create(), cancellationToken); 
}
