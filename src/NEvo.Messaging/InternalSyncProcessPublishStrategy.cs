using LanguageExt;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging;

public class InternalSyncProcessPublishStrategy(IMessageProcessor messageProcessor) : IInternalMessagePublishStrategy
{
    private IMessageProcessor _messageProcessor = messageProcessor;

    public async Task<Either<Exception, Unit>> PublishAsync(IMessage message) 
        => await _messageProcessor.ProcessMessageAsync(message, null, CancellationToken.None); //TODO; how i should get context?
}